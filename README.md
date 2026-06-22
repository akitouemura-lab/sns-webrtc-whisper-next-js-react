# Real-Time Voice Caption Translator

ブラウザで取得したマイク音声を数秒ごとにFastAPIへ送り、ローカルのWhisper系モデルで文字起こしし、必要に応じてArgos Translateで日本語へ翻訳するMVPです。履歴はSQLiteに保存します。

## 構成

```text
frontend/  Next.js + React
backend/   FastAPI + SQLite + faster-whisper + Argos Translate
```

このMVPでは、費用を抑えるためにクラウドAPIを使いません。`faster-whisper` と `argostranslate` が未導入でも、バックエンドはモック文字起こしで起動できます。UIやDB保存の動作確認を先に進められます。

## セットアップ

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

初回にWhisperモデルを使う場合はモデルのダウンロードが発生します。無料ですが、ネットワーク通信とディスク容量は必要です。
モデルを絶対に読み込ませずUIとDBだけ確認したい場合は、`.env`で `TRANSCRIBER_MODE=mock` にします。

実際の文字起こしとオフライン翻訳まで使う場合だけ、追加で任意依存を入れます。

```powershell
python -m pip install -r requirements-optional.txt
```

### Frontend

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

ブラウザで `http://localhost:3000` を開きます。

## Argos Translateの日本語翻訳モデル

Argos Translateはライブラリだけでは翻訳モデルが入りません。英語から日本語へ翻訳したい場合は、別途 `en -> ja` のパッケージをインストールしてください。モデル未導入時は文字起こしのみ表示されます。

## 主な機能

- MediaRecorder APIでマイク音声を4秒ごとに分割
- FastAPIへ音声チャンクをアップロード
- faster-whisperが入っていればローカル文字起こし
- Argos Translateが入っていればオフライン翻訳
- Reactで現在字幕と字幕履歴を表示
- SQLiteにセッションと字幕チャンクを保存
- 保存済み履歴の表示
- 簡易要約の生成

## 開発メモ

WebRTCはこのMVPでは使っていません。まずは「マイク音声のリアルタイム字幕化」を完成させ、複数人通話や画面共有音声を扱う段階でWebRTCを追加する方針です。
