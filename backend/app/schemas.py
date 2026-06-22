from __future__ import annotations

from pydantic import BaseModel


class Caption(BaseModel):
    id: int
    session_id: str
    chunk_index: int
    source_language: str
    target_language: str
    transcript: str
    translation: str | None = None
    duration_ms: int | None = None
    provider: str
    warning: str | None = None
    created_at: str


class Session(BaseModel):
    id: str
    title: str
    source_language: str
    target_language: str
    summary: str | None = None
    created_at: str
    updated_at: str
    caption_count: int = 0


class SessionUpdate(BaseModel):
    title: str


class TranscriptionResponse(BaseModel):
    session: Session
    caption: Caption


class ServiceStatus(BaseModel):
    whisper: dict[str, str | bool | float]
    translation: dict[str, str | bool | float]


class SummaryResponse(BaseModel):
    session_id: str
    style: str = "brief"
    summary: str


class DiagnosticResponse(BaseModel):
    text: str
    language: str
    duration_ms: int | None = None
    provider: str
    warning: str | None = None


class VocabularyItem(BaseModel):
    term: str
    count: int
    example: str
    meaning: str | None = None
