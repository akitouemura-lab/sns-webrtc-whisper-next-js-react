from __future__ import annotations

import os
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent

try:
    from dotenv import load_dotenv

    load_dotenv(BACKEND_DIR / ".env")
except Exception:
    pass


def _csv_env(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def _bool_env(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _float_env(name: str, default: str) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return float(default)


APP_NAME = os.getenv("APP_NAME", "Voice Caption Translator")
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", "storage/captions.sqlite3"))
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = BACKEND_DIR / DATABASE_PATH

CORS_ORIGINS = _csv_env(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)

WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_VAD_FILTER = _bool_env("WHISPER_VAD_FILTER", "false")
WHISPER_MIN_RMS = _float_env("WHISPER_MIN_RMS", "0.002")
WHISPER_MIN_PEAK = _float_env("WHISPER_MIN_PEAK", "0.015")

DEFAULT_SOURCE_LANGUAGE = os.getenv("DEFAULT_SOURCE_LANGUAGE", "auto")
DEFAULT_TARGET_LANGUAGE = os.getenv("DEFAULT_TARGET_LANGUAGE", "ja")
TRANSCRIBER_MODE = os.getenv("TRANSCRIBER_MODE", "auto").lower()
