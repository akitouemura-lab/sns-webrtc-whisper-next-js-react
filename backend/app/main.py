from __future__ import annotations

import tempfile
import re
from collections import Counter
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import config, database
from .schemas import (
    Caption,
    DiagnosticResponse,
    ServiceStatus,
    Session,
    SessionUpdate,
    SummaryResponse,
    TranscriptionResponse,
    VocabularyItem,
)
from .services.speech import recognizer
from .services.summary import build_summary
from .services.translation import translator


app = FastAPI(title=config.APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


EXPORT_FORMATS = {"txt", "md", "srt", "vtt"}
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_AUDIO_EXTENSIONS = {".webm", ".mp4", ".m4a", ".wav", ".mp3", ".ogg"}
ALLOWED_AUDIO_MIME_TYPES = {
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "video/webm",
    "video/mp4",
    "application/octet-stream",
}


def _caption_text(caption: dict) -> str:
    return caption.get("translation") or caption.get("transcript") or ""


def _validate_audio_upload(file: UploadFile) -> None:
    suffix = Path(file.filename or "").suffix.lower()
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    extension_allowed = suffix in ALLOWED_AUDIO_EXTENSIONS
    mime_allowed = content_type in ALLOWED_AUDIO_MIME_TYPES or content_type.startswith("audio/")
    if not extension_allowed and not mime_allowed:
        raise HTTPException(
            status_code=415,
            detail=(
                "Unsupported audio file type. "
                "Allowed formats include webm, mp4, wav, mp3, and ogg."
            ),
        )


async def _write_upload_to_temp(file: UploadFile, temp_file) -> None:
    total_bytes = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Audio upload is too large. Maximum size is 20MB.",
            )
        temp_file.write(chunk)


def _format_timestamp(ms: int, *, vtt: bool = False) -> str:
    hours = ms // 3_600_000
    ms %= 3_600_000
    minutes = ms // 60_000
    ms %= 60_000
    seconds = ms // 1_000
    millis = ms % 1_000
    separator = "." if vtt else ","
    return f"{hours:02}:{minutes:02}:{seconds:02}{separator}{millis:03}"


def _export_captions(session: dict, captions: list[dict], export_format: str) -> str:
    if export_format == "txt":
        lines = [session["title"], ""]
        current_ms = 0
        for caption in captions:
            lines.append(f"[{_format_timestamp(current_ms, vtt=True)[:8]}] {_caption_text(caption)}")
            current_ms += max(caption.get("duration_ms") or 6000, 1000)
        return "\n".join(lines).strip() + "\n"

    if export_format == "md":
        lines = [
            f"# {session['title']}",
            "",
            f"- Source: {session['source_language']}",
            f"- Target: {session['target_language']}",
            f"- Captions: {len(captions)}",
            "",
        ]
        if session.get("summary"):
            lines.extend(["## Summary", "", session["summary"], ""])
        lines.extend(["## Captions", ""])
        for caption in captions:
            text = _caption_text(caption).replace("|", "\\|")
            lines.append(f"- `{caption['chunk_index'] + 1}` {text}")
        return "\n".join(lines).strip() + "\n"

    current_ms = 0
    blocks: list[str] = []
    for index, caption in enumerate(captions, start=1):
        duration_ms = max(caption.get("duration_ms") or 6000, 1000)
        start_ms = current_ms
        end_ms = current_ms + duration_ms
        current_ms = end_ms
        text = _caption_text(caption)
        if export_format == "vtt":
            blocks.append(
                f"{_format_timestamp(start_ms, vtt=True)} --> "
                f"{_format_timestamp(end_ms, vtt=True)}\n{text}"
            )
        else:
            blocks.append(
                f"{index}\n{_format_timestamp(start_ms)} --> "
                f"{_format_timestamp(end_ms)}\n{text}"
            )
    prefix = "WEBVTT\n\n" if export_format == "vtt" else ""
    return prefix + "\n\n".join(blocks).strip() + "\n"


def _build_vocabulary(captions: list[dict], limit: int) -> list[VocabularyItem]:
    stop_words = {
        "the",
        "and",
        "for",
        "you",
        "that",
        "this",
        "with",
        "have",
        "from",
        "are",
        "was",
        "were",
        "but",
        "not",
        "your",
        "about",
        "what",
        "when",
        "where",
        "there",
        "their",
        "then",
        "will",
        "can",
        "could",
        "would",
        "should",
        "speech",
        "detected",
    }
    transcript_texts = [caption.get("transcript") or "" for caption in captions]
    words = re.findall(r"[A-Za-z][A-Za-z'-]{2,}", " ".join(transcript_texts).lower())
    counts = Counter(word for word in words if word not in stop_words)
    items: list[VocabularyItem] = []
    for term, count in counts.most_common(limit):
        example = next(
            (text for text in transcript_texts if re.search(rf"\b{re.escape(term)}\b", text, re.I)),
            "",
        )
        items.append(VocabularyItem(term=term, count=count, example=example, meaning=None))
    return items


@app.on_event("startup")
def on_startup() -> None:
    database.init_db()


@app.get("/api/health", response_model=ServiceStatus)
def health() -> ServiceStatus:
    return ServiceStatus(
        whisper=recognizer.status(),
        translation=translator.status(),
    )


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_chunk(
    file: UploadFile = File(...),
    session_id: str | None = Form(None),
    chunk_index: int = Form(0),
    source_language: str = Form(config.DEFAULT_SOURCE_LANGUAGE),
    target_language: str = Form(config.DEFAULT_TARGET_LANGUAGE),
    translate: bool = Form(True),
) -> TranscriptionResponse:
    _validate_audio_upload(file)
    suffix = Path(file.filename or "chunk.webm").suffix or ".webm"
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_path = Path(temp_file.name)
    try:
        with temp_file:
            await _write_upload_to_temp(file, temp_file)

        current_session_id = session_id or str(uuid4())
        session = database.ensure_session(
            session_id=current_session_id,
            source_language=source_language,
            target_language=target_language,
        )

        speech = recognizer.transcribe(temp_path, source_language)
        should_translate = (
            translate
            and speech.text
            and not speech.text.startswith("(")
            and speech.language != "unknown"
        )
        translation = (
            translator.translate(speech.text, speech.language, target_language)
            if should_translate
            else None
        )

        warning = speech.warning
        if translation and translation.warning:
            warning = f"{warning} {translation.warning}".strip() if warning else translation.warning

        caption = database.insert_caption(
            session_id=current_session_id,
            chunk_index=chunk_index,
            source_language=speech.language,
            target_language=target_language,
            transcript=speech.text,
            translation=translation.text if translation else None,
            duration_ms=speech.duration_ms,
            provider=speech.provider,
            warning=warning,
        )
        refreshed_session = database.get_session(session["id"])
        if refreshed_session is None:
            raise HTTPException(status_code=500, detail="Session was not saved")
        return TranscriptionResponse(
            session=Session(**refreshed_session),
            caption=Caption(**caption),
        )
    finally:
        database.safe_unlink(temp_path)


@app.post("/api/diagnose", response_model=DiagnosticResponse)
async def diagnose_chunk(
    file: UploadFile = File(...),
    source_language: str = Form(config.DEFAULT_SOURCE_LANGUAGE),
) -> DiagnosticResponse:
    _validate_audio_upload(file)
    suffix = Path(file.filename or "diagnostic.webm").suffix or ".webm"
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_path = Path(temp_file.name)
    try:
        with temp_file:
            await _write_upload_to_temp(file, temp_file)
        speech = recognizer.transcribe(temp_path, source_language)
        return DiagnosticResponse(
            text=speech.text,
            language=speech.language,
            duration_ms=speech.duration_ms,
            provider=speech.provider,
            warning=speech.warning,
        )
    finally:
        database.safe_unlink(temp_path)


@app.get("/api/sessions", response_model=list[Session])
def get_sessions(query: str | None = Query(None)) -> list[Session]:
    return [Session(**row) for row in database.list_sessions(query)]


@app.get("/api/sessions/{session_id}", response_model=Session)
def get_session(session_id: str) -> Session:
    row = database.get_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return Session(**row)


@app.patch("/api/sessions/{session_id}", response_model=Session)
def update_session(session_id: str, payload: SessionUpdate) -> Session:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    row = database.update_session_title(session_id, title)
    if row is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return Session(**row)


@app.get("/api/sessions/{session_id}/captions", response_model=list[Caption])
def get_captions(session_id: str) -> list[Caption]:
    if database.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return [Caption(**row) for row in database.list_captions(session_id)]


@app.post("/api/sessions/{session_id}/summary", response_model=SummaryResponse)
def summarize_session(
    session_id: str,
    style: str = Query("brief", pattern="^(brief|bullets|keywords|todos)$"),
) -> SummaryResponse:
    if database.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    captions = database.list_captions(session_id)
    texts = [caption.get("translation") or caption.get("transcript") or "" for caption in captions]
    summary = build_summary(texts, style=style)
    database.update_summary(session_id, summary)
    return SummaryResponse(session_id=session_id, style=style, summary=summary)


@app.get("/api/sessions/{session_id}/vocabulary", response_model=list[VocabularyItem])
def get_vocabulary(
    session_id: str,
    limit: int = Query(20, ge=1, le=100),
) -> list[VocabularyItem]:
    if database.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    captions = database.list_captions(session_id)
    return _build_vocabulary(captions, limit)


@app.get("/api/sessions/{session_id}/export")
def export_session(
    session_id: str,
    format: str = Query("txt", pattern="^(txt|md|srt|vtt)$"),
) -> Response:
    session = database.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    captions = database.list_captions(session_id)
    export_text = _export_captions(session, captions, format)
    filename = f"{session['title'].replace(' ', '_')}.{format}"
    media_type = "text/vtt" if format == "vtt" else "text/plain"
    return Response(
        content=export_text,
        media_type=f"{media_type}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
