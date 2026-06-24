# Local Voice Caption Translator

ブラウザで取得した音声を数秒ごとに分割し、FastAPIバックエンドで文字起こし・翻訳・保存するリアルタイム音声字幕アプリです。

リポジトリ名には `sns` / `webrtc` が含まれていますが、現在のMVPではWebRTCによる複数人通話機能は未実装です。本プロジェクトは、将来的なリアルタイム通話・画面共有コミュニケーション機能の前段階として、ブラウザ音声入力と画面共有音声をリアルタイムに文字起こし・翻訳・保存する基盤を実装したものです。

クラウド翻訳APIを使わず、`faster-whisper` と `Argos Translate` を中心にローカル処理で構成しているため、API費用を抑えながら、音声データの扱いにも配慮した設計になっています。

---

## Demo

![Demo Screenshot](docs/assets/demo-screenshot.png)

---

## What This App Does

ブラウザでマイク音声、または画面共有・タブ音声を取得し、MediaRecorder APIで数秒単位の音声チャンクに分割します。各チャンクをFastAPIへアップロードし、バックエンド側でWhisper系モデルによる文字起こし、必要に応じてArgos Translateによるオフライン翻訳を行います。

生成された字幕はReact UIにリアルタイム表示され、セッション履歴としてSQLiteへ保存されます。後から要約、単語抽出、`txt` / `md` / `srt` / `vtt` 形式でのエクスポートもできます。

---

## Portfolio Highlights

- **フルスタック開発**: Next.js / React / TypeScript フロントエンド、FastAPIバックエンド、SQLite保存、音声処理を一体で実装
- **ローカルAI活用**: `faster-whisper` によるローカル音声認識と、`Argos Translate` によるオフライン翻訳に対応
- **API費用への配慮**: クラウド翻訳APIに依存しないため、試作・デモ運用時のコストを抑えやすい
- **プライバシーへの配慮**: 音声処理と翻訳をローカル環境中心で行う設計
- **リアルタイム性と安定性**: 長時間録音を直接送らず、短い音声チャンクに分割して送信
- **ユーザー補助機能**: マイク診断、音量メーター、処理待ちキュー、履歴保存、セッション名編集、字幕エクスポートを実装

---

## Implemented Features

### Audio Capture

- マイク音声の録音
- 画面共有・タブ音声の取得
- MediaRecorder APIによる音声チャンク分割
- Web Audio APIによる入力ゲイン調整と音量メーター
- マイク初期診断

### Transcription and Translation

- FastAPIへの音声チャンクアップロード
- `faster-whisper` によるローカル文字起こし
- `Argos Translate` によるオフライン翻訳
- モックモードによるUI・DB動作確認
- 無音または低音量チャンクの検出

### Data and Productivity

- SQLiteによるセッション・字幕保存
- セッション履歴表示
- セッション名編集
- 字幕の誤認識を後から修正できる字幕編集
- 不要になった履歴を整理できるセッション削除
- 履歴検索
- 要約タイプ選択
  - 通常要約
  - 箇条書き
  - 重要単語
  - TODO
- 英語字幕からの単語候補抽出
- `txt` / `md` / `srt` / `vtt` エクスポート
- 処理待ちキュー表示

---

## Not Implemented Yet

現在のMVPでは、以下は未実装です。

- WebRTCによる複数人通話
- SNSチャット機能
- ユーザー認証
- クラウド同期
- 話者分離
- 本番環境向けの権限管理

これらは今後の発展機能として想定しています。現在は、WebRTC通話アプリへ拡張するための音声取得・音声認識・翻訳・保存基盤に集中しています。

---

## Tech Stack

### Frontend

- Next.js
- React
- TypeScript
- MediaRecorder API
- Web Audio API

### Backend

- Python
- FastAPI
- SQLite
- faster-whisper
- Argos Translate

### Quality / CI

- TypeScript type-check
- Next.js production build
- GitHub Actions
- FastAPI app import check

---

## Architecture

```text
Browser
  |
  | microphone / screen or tab audio
  v
Next.js + React
  |
  | MediaRecorder audio chunk
  v
FastAPI Backend
  |
  |-- upload validation
  |-- faster-whisper transcription
  |-- Argos Translate offline translation
  |-- SQLite session and caption storage
  |-- summary / vocabulary / export API
```

音声を短いチャンクに分割して送ることで、リアルタイム性を保ちながら、長時間録音ファイルを一括アップロードするよりも失敗しにくい構成にしています。

---

## Project Structure

```text
.
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── config.py
│   │   ├── schemas.py
│   │   └── services/
│   │       ├── speech.py
│   │       ├── translation.py
│   │       └── summary.py
│   ├── scripts/
│   │   └── install_argos_model.py
│   ├── storage/
│   │   └── .gitkeep
│   ├── requirements.txt
│   ├── requirements-optional.txt
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   └── lib/
│   │       └── api.ts
│   ├── package.json
│   └── tsconfig.json
│
├── docs/
│   └── assets/
│       └── demo-screenshot.png
│
├── .github/
│   └── workflows/
│       └── ci.yml
├── .gitignore
└── README.md
```

---

## Setup

### 1. Clone Repository

```powershell
git clone https://github.com/akitouemura-lab/sns-webrtc-whisper-next-js-react.git
cd sns-webrtc-whisper-next-js-react
```

### 2. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Backend API:

```text
http://127.0.0.1:8000
```

Health check:

```text
http://127.0.0.1:8000/api/health
```

### 3. Optional: Real Transcription and Translation

標準依存のみでも、モックモードでUIとDB保存の動作確認ができます。実際にWhisper文字起こしとArgos Translate翻訳を使う場合は、追加依存をインストールします。

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-optional.txt
```

### 4. Optional: Argos Translate Model

`Argos Translate` はライブラリだけでは翻訳モデルが含まれません。英語から日本語へ翻訳する場合は、`en -> ja` の翻訳モデルを別途インストールします。

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python scripts\install_argos_model.py
```

### 5. Frontend

別ターミナルで実行します。

```powershell
cd frontend
npm.cmd install
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

Frontend:

```text
http://127.0.0.1:3000
```

---

## Docker

Docker Compose can start both the FastAPI backend and the Next.js frontend:

```powershell
docker compose up --build
```

The frontend is available at:

```text
http://localhost:3000
```

The backend API is available at:

```text
http://localhost:8000
```

The Docker setup uses `TRANSCRIBER_MODE=mock` by default so the full UI, API, SQLite persistence, history, summaries, and exports can be demonstrated without downloading heavy Whisper or Argos Translate dependencies. For real local transcription and translation, use the local setup steps and install `requirements-optional.txt`.

---

## Environment Variables

`backend/.env.example` をコピーして `backend/.env` を作成します。

```env
APP_NAME=Voice Caption Translator
DATABASE_PATH=storage/captions.sqlite3

CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

TRANSCRIBER_MODE=auto
WHISPER_MODEL_SIZE=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_VAD_FILTER=false
WHISPER_MIN_RMS=0.002
WHISPER_MIN_PEAK=0.015

DEFAULT_SOURCE_LANGUAGE=en
DEFAULT_TARGET_LANGUAGE=ja
```

### Main Options

| Variable | Description |
| --- | --- |
| `TRANSCRIBER_MODE` | `auto`, `whisper`, or `mock` |
| `WHISPER_MODEL_SIZE` | Whisper model size. Example: `tiny`, `base`, `small` |
| `WHISPER_DEVICE` | `cpu` or `cuda` |
| `WHISPER_COMPUTE_TYPE` | Example: `int8`, `float16` |
| `WHISPER_MIN_RMS` | Minimum RMS level for audio chunk processing |
| `WHISPER_MIN_PEAK` | Minimum peak level for audio chunk processing |
| `DEFAULT_SOURCE_LANGUAGE` | Default source language |
| `DEFAULT_TARGET_LANGUAGE` | Default target language |

---

## Mock Mode

`faster-whisper` や `Argos Translate` を入れていない環境でも、モックモードでUI、API、SQLite保存の流れを確認できます。

```env
TRANSCRIBER_MODE=mock
```

この場合、実際の音声認識は行わず、受け取った音声チャンクの保存と画面表示を確認できます。

---

## API Overview

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Whisper / translation service status |
| `POST` | `/api/transcribe` | Upload one audio chunk and save caption |
| `POST` | `/api/diagnose` | Test microphone audio without saving a session |
| `GET` | `/api/sessions` | List or search sessions |
| `PATCH` | `/api/sessions/{session_id}` | Rename a session |
| `GET` | `/api/sessions/{session_id}/captions` | List captions in a session |
| `POST` | `/api/sessions/{session_id}/summary` | Build a summary |
| `GET` | `/api/sessions/{session_id}/vocabulary` | Extract vocabulary candidates |
| `GET` | `/api/sessions/{session_id}/export` | Export captions as `txt`, `md`, `srt`, or `vtt` |

Audio upload endpoints validate file size and basic audio file type. The default maximum upload size is 20MB per chunk.

---

## Verification

Frontend:

```powershell
cd frontend
npm.cmd install
npm.cmd run type-check
npm.cmd run build
```

Backend:

```powershell
cd backend
python -m pip install -r requirements.txt
python -c "from app.main import app; print(app.title)"
```

---

## CI

GitHub Actions runs the following checks:

- Frontend dependency installation
- TypeScript type-check
- Next.js production build
- Backend dependency installation
- FastAPI app import check

Optional AI dependencies are intentionally not required in CI because `faster-whisper`, `Argos Translate`, and their model files are heavy for a lightweight portfolio pipeline.

---

## Roadmap

- WebRTC-based multi-user calling
- Real-time shared room UI
- Speaker diarization
- User authentication
- Export management UI
- More robust dictionary and vocabulary saving
- Production deployment configuration

---

## Notes

This project is currently focused on the core pipeline required for a voice caption product: browser audio capture, chunk upload, local transcription, optional offline translation, persistent history, and export. WebRTC calling and SNS-style features are planned as future expansion, not current MVP functionality.
