from __future__ import annotations

import os
import tempfile
from pathlib import Path

os.environ["TRANSCRIBER_MODE"] = "mock"
os.environ["DATABASE_PATH"] = str(
    Path(tempfile.gettempdir()) / f"voice-caption-api-test-{os.getpid()}.sqlite3"
)

from fastapi.testclient import TestClient

from app import config, database
from app.main import app


def make_client():
    database.safe_unlink(config.DATABASE_PATH)
    database.init_db()
    return TestClient(app)


def test_health_returns_service_status():
    with make_client() as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    data = response.json()
    assert data["whisper"]["mode"] == "mock"
    assert "translation" in data


def test_sessions_returns_list():
    with make_client() as client:
        response = client.get("/api/sessions")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_missing_session_returns_404():
    with make_client() as client:
        response = client.get("/api/sessions/missing-session")

    assert response.status_code == 404
    assert response.json()["detail"] == "Session not found"
