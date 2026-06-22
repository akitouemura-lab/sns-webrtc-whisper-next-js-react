# Local Voice Caption Translator

ローカル環境で音声を文字起こしし、日本語字幕として表示するリアルタイム音声字幕・翻訳アプリです。

ブラウザで取得したマイク音声または画面共有音声を数秒ごとに分割し、FastAPIバックエンドへ送信します。バックエンドでは `faster-whisper` による音声認識、`Argos Translate` によるオフライン翻訳、SQLiteによる字幕履歴保存を行います。

クラウド翻訳APIを使わず、ローカル処理を中心に構成しているため、API費用を抑えながらプライバシーにも配慮した設計を目指しました。

---

## Demo

![Demo Screenshot](docs/assets/demo-screenshot.png)

> Demo video: `docs/assets/demo.mp4`
> ※ デモ動画は必要に応じて追加してください。

---

## Features

* マイク音声のリアルタイム録音
* 画面共有・タブ音声の取得
* MediaRecorder APIによる音声チャンク分割
* FastAPIへの音声アップロード
* `faster-whisper` によるローカル音声認識
* `Argos Translate` によるオフライン翻訳
* SQLiteによる字幕履歴保存
* セッションごとの字幕履歴表示
* セッション名の編集
* 簡易要約・キーワード抽出
* `txt` / `md` / `srt` / `vtt` 形式での字幕エクスポート
* マイク入力診断機能
* モックモードによるUI・DB動作確認

---

## Tech Stack

### Frontend

* Next.js
* React
* TypeScript
* MediaRecorder API
* Web Audio API

### Backend

* Python
* FastAPI
* SQLite
* faster-whisper
* Argos Translate

---

## Architecture

```text
Browser
  |
  | Audio chunk
  v
Next.js Frontend
  |
  | multipart/form-data
  v
FastAPI Backend
  |
  |-- faster-whisper: speech-to-text
  |-- Argos Translate: offline translation
  |-- SQLite: session and caption storage
```

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
│       ├── demo-screenshot.png
│       └── demo.mp4
│
├── .gitignore
└── README.md
```

---

## Setup

### 1. Clone repository

```powershell
git clone https://github.com/akitouemura-lab/sns-webrtc-whisper-next-js-react.git
cd sns-webrtc-whisper-next-js-react
```

---

### 2. Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Backend API:

```text
http://localhost:8000
```

Health check:

```text
http://localhost:8000/api/health
```

---

### 3. Optional: Enable real transcription and translation

標準依存のみでも、モック文字起こしによってUIとDB保存の動作確認ができます。

実際に音声認識と翻訳を使う場合は、追加依存をインストールします。

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-optional.txt
```

---

### 4. Install Argos Translate model

`Argos Translate` はライブラリをインストールしただけでは翻訳モデルが入りません。

英語から日本語へ翻訳する場合は、`en -> ja` の翻訳モデルを別途インストールします。

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python scripts\install_argos_model.py
```

成功すると、英語音声の文字起こし結果を日本語へ翻訳できるようになります。

---

### 5. Frontend setup

別ターミナルで実行します。

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Frontend:

```text
http://localhost:3000
```

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

### Main options

| Variable                  | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `TRANSCRIBER_MODE`        | `auto`, `whisper`, or `mock`                         |
| `WHISPER_MODEL_SIZE`      | Whisper model size. Example: `tiny`, `base`, `small` |
| `WHISPER_DEVICE`          | `cpu` or `cuda`                                      |
| `WHISPER_COMPUTE_TYPE`    | Example: `int8`, `float16`                           |
| `DEFAULT_SOURCE_LANGUAGE` | Default source language                              |
| `DEFAULT_TARGET_LANGUAGE` | Default target language                              |

---

## Mock Mode

このアプリは、`faster-whisper` や `Argos Translate` が未導入でも起動できます。

UIやDB保存だけを確認したい場合は、`backend/.env` で以下のように設定します。

```env
TRANSCRIBER_MODE=mock
```

この場合、実際の音声認識は行われず、モック文字起こしが保存されます。

---

## Real Transcription Mode

実際に音声認識を行う場合は、以下のように設定します。

```env
TRANSCRIBER_MODE=auto
```

または、Whisperを必ず使う場合は以下のようにします。

```env
TRANSCRIBER_MODE=whisper
```

初回実行時にはWhisperモデルのダウンロードが発生する場合があります。
無料で利用できますが、ネットワーク通信とディスク容量が必要です。

---

## Main API Endpoints

| Method  | Endpoint                                | Description                     |
| ------- | --------------------------------------- | ------------------------------- |
| `GET`   | `/api/health`                           | Whisper / Argos Translate の状態確認 |
| `POST`  | `/api/transcribe`                       | 音声チャンクの文字起こし・翻訳・保存              |
| `POST`  | `/api/diagnose`                         | マイク診断                           |
| `GET`   | `/api/sessions`                         | 保存済みセッション一覧                     |
| `GET`   | `/api/sessions/{session_id}`            | セッション情報取得                       |
| `PATCH` | `/api/sessions/{session_id}`            | セッション名の更新                       |
| `GET`   | `/api/sessions/{session_id}/captions`   | セッション内の字幕取得                     |
| `POST`  | `/api/sessions/{session_id}/summary`    | 簡易要約生成                          |
| `GET`   | `/api/sessions/{session_id}/vocabulary` | 重要単語抽出                          |
| `GET`   | `/api/sessions/{session_id}/export`     | `txt` / `md` / `srt` / `vtt` 出力 |

---

## How It Works

### 1. Audio recording

フロントエンドでは、ブラウザの `MediaRecorder API` を使用してマイク音声または画面共有音声を取得します。

音声は数秒ごとのチャンクに分割され、バックエンドへアップロードされます。

### 2. Speech-to-text

バックエンドでは、受け取った音声チャンクを一時ファイルとして保存し、`faster-whisper` に渡して文字起こしします。

音声レベルが小さすぎる場合は、文字起こしを行わず警告を返すことで、無音やノイズによる誤認識を減らします。

### 3. Offline translation

翻訳が有効な場合、文字起こしされたテキストを `Argos Translate` で日本語へ翻訳します。

クラウドAPIを使わないため、API利用料金を発生させずに翻訳処理を行えます。

### 4. History storage

文字起こし結果と翻訳結果はSQLiteに保存されます。

保存されたセッションは後から検索・閲覧でき、要約や字幕ファイルとしてのエクスポートにも利用できます。

---

## Database Design

このアプリでは、SQLiteで以下の2種類のデータを管理します。

### sessions

録音・字幕生成の単位を管理します。

| Column            | Description       |
| ----------------- | ----------------- |
| `id`              | Session ID        |
| `title`           | Session title     |
| `source_language` | Source language   |
| `target_language` | Target language   |
| `summary`         | Generated summary |
| `created_at`      | Created timestamp |
| `updated_at`      | Updated timestamp |

### captions

各音声チャンクの文字起こし・翻訳結果を管理します。

| Column            | Description                          |
| ----------------- | ------------------------------------ |
| `id`              | Caption ID                           |
| `session_id`      | Parent session ID                    |
| `chunk_index`     | Audio chunk index                    |
| `source_language` | Detected or selected source language |
| `target_language` | Target language                      |
| `transcript`      | Speech recognition result            |
| `translation`     | Translation result                   |
| `duration_ms`     | Audio duration                       |
| `provider`        | Transcription provider               |
| `warning`         | Warning message                      |
| `created_at`      | Created timestamp                    |

---

## Export Formats

セッションごとの字幕履歴は以下の形式でエクスポートできます。

| Format | Purpose                |
| ------ | ---------------------- |
| `txt`  | Simple text transcript |
| `md`   | Markdown notes         |
| `srt`  | Subtitle file          |
| `vtt`  | Web subtitle file      |

---

## Development Notes

このMVPでは、WebRTCによる複数人通話機能はまだ実装していません。

まずは「音声入力 → 文字起こし → 翻訳 → 履歴保存」までの基礎機能を完成させ、将来的にWebRTCによる複数人通話音声や画面共有音声へ拡張する方針です。

---

## What I Learned

この開発を通して、フロントエンド・バックエンド・音声処理・ローカルAIモデル・DB保存を組み合わせたフルスタック開発を経験しました。

特に、リアルタイム音声処理では以下の点を意識しました。

* 音声を一定秒数ごとに分割して送信する設計
* 音声認識に失敗した場合でもアプリ全体が止まらないエラーハンドリング
* API費用を抑えるためのローカルAIモデル活用
* 履歴保存と検索により、字幕を後から再利用できる設計
* マイク入力レベル診断によるユーザー補助
* 文字起こし、翻訳、保存、要約、エクスポートまでを一連の流れとして扱う設計

---

## Challenges

開発中に特に難しかった点は、リアルタイム性と安定性の両立です。

音声を短い間隔で送信すると字幕表示は早くなりますが、処理待ちが増えやすくなります。
一方で、チャンクを長くすると認識は安定しやすくなりますが、字幕表示までの遅延が大きくなります。

そのため、このアプリでは数秒単位で音声を分割し、処理待ち件数をUIに表示することで、ユーザーが状態を把握できるようにしました。

また、音声入力が小さい場合にはマイク診断や警告を表示し、認識失敗の原因をユーザーが確認できるようにしています。

---

## Future Improvements

* WebRTCによる複数人通話対応
* 話者分離
* 翻訳精度の改善
* 字幕表示UIの改善
* Docker対応
* GitHub Actionsによる自動テスト
* 音声ファイルアップロード対応
* デモページの公開
* セッション削除機能
* 認識結果の手動編集機能
* 長時間録音時のパフォーマンス改善

---

## Author

Developed by **akito uemura**

GitHub: [akitouemura-lab](https://github.com/akitouemura-lab)

Repository: [sns-webrtc-whisper-next-js-react](https://github.com/akitouemura-lab/sns-webrtc-whisper-next-js-react)

---

## Summary

Local Voice Caption Translator is a local-first real-time voice caption and translation application.

It demonstrates how browser audio capture, backend APIs, local AI models, offline translation, and persistent storage can be combined into a practical full-stack application.

The goal is simple:

> Make spoken language easier to understand, translate, save, and reuse without relying on paid cloud translation APIs.
