from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from .. import config


class AudioStats(TypedDict):
    rms: float
    peak: float
    duration_ms: int


@dataclass
class SpeechResult:
    text: str
    language: str
    duration_ms: int | None
    provider: str
    warning: str | None = None


class SpeechRecognizer:
    def __init__(self) -> None:
        self._model = None
        self._load_error: str | None = None

    def status(self) -> dict[str, str | bool]:
        available = config.TRANSCRIBER_MODE == "mock" or self._model is not None or self._can_import()
        return {
            "available": available,
            "loaded": self._model is not None,
            "mode": config.TRANSCRIBER_MODE,
            "model": config.WHISPER_MODEL_SIZE,
            "device": config.WHISPER_DEVICE,
            "compute_type": config.WHISPER_COMPUTE_TYPE,
            "vad_filter": config.WHISPER_VAD_FILTER,
            "min_rms": config.WHISPER_MIN_RMS,
            "min_peak": config.WHISPER_MIN_PEAK,
            "error": self._load_error or "",
        }

    def transcribe(self, audio_path: Path, language: str) -> SpeechResult:
        if config.TRANSCRIBER_MODE == "mock":
            return self._mock_result(audio_path)

        model = self._get_model()
        if model is None:
            return self._mock_result(audio_path)

        requested_language = None if language == "auto" else language
        audio_stats = self._audio_stats(audio_path)
        if audio_stats and (
            audio_stats["rms"] < config.WHISPER_MIN_RMS
            and audio_stats["peak"] < config.WHISPER_MIN_PEAK
        ):
            return SpeechResult(
                text="(no speech detected)",
                language=requested_language or "unknown",
                duration_ms=audio_stats["duration_ms"],
                provider="audio-level",
                warning=(
                    "Audio level is too low for transcription "
                    f"(rms={audio_stats['rms']:.4f}, peak={audio_stats['peak']:.4f})."
                ),
            )

        try:
            segments, info = model.transcribe(
                str(audio_path),
                language=requested_language,
                vad_filter=config.WHISPER_VAD_FILTER,
                beam_size=5,
                condition_on_previous_text=False,
                initial_prompt=None,
                no_speech_threshold=0.6,
            )
        except Exception as exc:
            return SpeechResult(
                text="(audio could not be decoded)",
                language=requested_language or "unknown",
                duration_ms=None,
                provider="faster-whisper",
                warning=f"Whisper could not decode this audio chunk: {exc}",
            )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if not text:
            text = "(no speech detected)"
        duration = getattr(info, "duration", None)
        duration_ms = int(duration * 1000) if duration else None
        detected_language = getattr(info, "language", None) or requested_language or "unknown"
        return SpeechResult(
            text=text,
            language=detected_language,
            duration_ms=duration_ms,
            provider="faster-whisper",
        )

    @staticmethod
    def _audio_stats(audio_path: Path) -> AudioStats | None:
        try:
            from faster_whisper.audio import decode_audio

            audio = decode_audio(str(audio_path), sampling_rate=16000)
            if audio.size == 0:
                return {"rms": 0.0, "peak": 0.0, "duration_ms": 0}
            peak = float(abs(audio).max())
            rms = float((audio * audio).mean() ** 0.5)
            duration_ms = int((audio.size / 16000) * 1000)
            return {"rms": rms, "peak": peak, "duration_ms": duration_ms}
        except Exception:
            return None

    def _can_import(self) -> bool:
        try:
            import faster_whisper  # noqa: F401
        except Exception as exc:
            self._load_error = str(exc)
            return False
        return True

    def _get_model(self):
        if self._model is not None:
            return self._model
        if config.TRANSCRIBER_MODE not in {"auto", "whisper"}:
            return None
        try:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                config.WHISPER_MODEL_SIZE,
                device=config.WHISPER_DEVICE,
                compute_type=config.WHISPER_COMPUTE_TYPE,
            )
        except Exception as exc:
            self._load_error = str(exc)
            self._model = None
        return self._model

    @staticmethod
    def _mock_result(audio_path: Path) -> SpeechResult:
        warning = (
            "Mock transcription is enabled. Install optional dependencies and set "
            "TRANSCRIBER_MODE=auto or whisper to enable real transcription."
        )
        return SpeechResult(
            text=f"[mock] Received audio chunk: {audio_path.name}",
            language="unknown",
            duration_ms=None,
            provider="mock",
            warning=warning,
        )


recognizer = SpeechRecognizer()
