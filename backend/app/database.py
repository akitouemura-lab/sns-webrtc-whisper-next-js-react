from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    config.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(config.DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with connect() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source_language TEXT NOT NULL,
                target_language TEXT NOT NULL,
                summary TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS captions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                source_language TEXT NOT NULL,
                target_language TEXT NOT NULL,
                transcript TEXT NOT NULL,
                translation TEXT,
                duration_ms INTEGER,
                provider TEXT NOT NULL,
                warning TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
            """
        )
        db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_captions_session_id
            ON captions(session_id, chunk_index, id)
            """
        )
        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_captions_unique_chunk
            ON captions(session_id, chunk_index)
            """
        )


def ensure_session(
    *,
    session_id: str,
    source_language: str,
    target_language: str,
    title: str | None = None,
) -> dict[str, Any]:
    now = utc_now()
    session_title = title or f"Session {now[:19].replace('T', ' ')}"
    with connect() as db:
        db.execute(
            """
            INSERT INTO sessions (id, title, source_language, target_language, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source_language = excluded.source_language,
                target_language = excluded.target_language,
                updated_at = excluded.updated_at
            """,
            (session_id, session_title, source_language, target_language, now, now),
        )
        row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row)


def insert_caption(
    *,
    session_id: str,
    chunk_index: int,
    source_language: str,
    target_language: str,
    transcript: str,
    translation: str | None,
    duration_ms: int | None,
    provider: str,
    warning: str | None,
) -> dict[str, Any]:
    now = utc_now()
    with connect() as db:
        existing = db.execute(
            """
            SELECT * FROM captions
            WHERE session_id = ? AND chunk_index = ?
            """,
            (session_id, chunk_index),
        ).fetchone()
        if existing:
            return dict(existing)

        cursor = db.execute(
            """
            INSERT INTO captions (
                session_id, chunk_index, source_language, target_language,
                transcript, translation, duration_ms, provider, warning, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                chunk_index,
                source_language,
                target_language,
                transcript,
                translation,
                duration_ms,
                provider,
                warning,
                now,
            ),
        )
        db.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        row = db.execute(
            "SELECT * FROM captions WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return dict(row)


def list_sessions(query: str | None = None) -> list[dict[str, Any]]:
    search = (query or "").strip()
    with connect() as db:
        params: list[Any] = []
        where = ""
        if search:
            like = f"%{search}%"
            params.extend([like, like, like, like])
            where = """
            WHERE
                sessions.title LIKE ?
                OR COALESCE(sessions.summary, '') LIKE ?
                OR EXISTS (
                    SELECT 1 FROM captions
                    WHERE captions.session_id = sessions.id
                    AND (
                        captions.transcript LIKE ?
                        OR COALESCE(captions.translation, '') LIKE ?
                    )
                )
            """
        rows = db.execute(
            f"""
            SELECT
                sessions.*,
                COUNT(captions.id) AS caption_count
            FROM sessions
            LEFT JOIN captions ON captions.session_id = sessions.id
            {where}
            GROUP BY sessions.id
            ORDER BY sessions.updated_at DESC
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]


def get_session(session_id: str) -> dict[str, Any] | None:
    with connect() as db:
        row = db.execute(
            """
            SELECT
                sessions.*,
                COUNT(captions.id) AS caption_count
            FROM sessions
            LEFT JOIN captions ON captions.session_id = sessions.id
            WHERE sessions.id = ?
            GROUP BY sessions.id
            """,
            (session_id,),
        ).fetchone()
        return dict(row) if row else None


def list_captions(session_id: str) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute(
            """
            SELECT * FROM captions
            WHERE session_id = ?
            ORDER BY chunk_index ASC, id ASC
            """,
            (session_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def update_summary(session_id: str, summary: str) -> dict[str, Any] | None:
    now = utc_now()
    with connect() as db:
        db.execute(
            "UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?",
            (summary, now, session_id),
        )
        row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None


def update_session_title(session_id: str, title: str) -> dict[str, Any] | None:
    now = utc_now()
    with connect() as db:
        db.execute(
            "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, session_id),
        )
        row = db.execute(
            """
            SELECT
                sessions.*,
                COUNT(captions.id) AS caption_count
            FROM sessions
            LEFT JOIN captions ON captions.session_id = sessions.id
            WHERE sessions.id = ?
            GROUP BY sessions.id
            """,
            (session_id,),
        ).fetchone()
        return dict(row) if row else None


def safe_unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
