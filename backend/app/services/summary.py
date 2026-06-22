from __future__ import annotations

import re
from collections import Counter


def _sentences(text: str) -> list[str]:
    parts = re.findall(r"[^.!?。！？]+[.!?。！？]?", text)
    return [part.strip() for part in parts if part.strip()]


def _keywords(text: str, limit: int = 8) -> list[str]:
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
    }
    words = re.findall(r"[A-Za-z][A-Za-z'-]{2,}|[\u3040-\u30ff\u3400-\u9fff]{2,}", text.lower())
    filtered = [word for word in words if word not in stop_words]
    return [word for word, _ in Counter(filtered).most_common(limit)]


def build_summary(texts: list[str], style: str = "brief", max_sentences: int = 4) -> str:
    combined = " ".join(text.strip() for text in texts if text.strip())
    if not combined:
        return "字幕履歴がまだありません。"

    sentences = _sentences(combined) or [combined]
    keywords = _keywords(combined)

    if style == "bullets":
        return "\n".join(f"- {sentence}" for sentence in sentences[:max_sentences])

    if style == "keywords":
        if not keywords:
            return "重要キーワードはまだ抽出できません。"
        return "重要キーワード\n" + "\n".join(f"- {word}" for word in keywords)

    if style == "todos":
        todo_markers = (
            "todo",
            "must",
            "should",
            "need",
            "必要",
            "確認",
            "対応",
            "やる",
            "します",
            "してください",
        )
        todos = [
            sentence
            for sentence in sentences
            if any(marker in sentence.lower() for marker in todo_markers)
        ]
        if not todos:
            return "TODO候補は見つかりませんでした。"
        return "TODO候補\n" + "\n".join(f"- {todo}" for todo in todos[:max_sentences])

    lines = sentences[:max_sentences]
    if keywords:
        lines.append("Keywords: " + ", ".join(keywords[:6]))
    return "\n".join(lines)
