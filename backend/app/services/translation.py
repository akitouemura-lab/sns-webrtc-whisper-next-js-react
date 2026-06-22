from __future__ import annotations

from dataclasses import dataclass


@dataclass
class TranslationResult:
    text: str | None
    provider: str
    warning: str | None = None


class ArgosTranslator:
    def __init__(self) -> None:
        self._load_error: str | None = None
        self._runtime_error: str | None = None

    def status(self) -> dict[str, str | bool]:
        available = self._can_import()
        return {
            "available": available and self._runtime_error is None,
            "provider": "argos-translate" if available else "none",
            "error": self._runtime_error or self._load_error or "",
        }

    def translate(self, text: str, source_language: str, target_language: str) -> TranslationResult:
        if not text:
            return TranslationResult(text=None, provider="none")
        if target_language == "none" or source_language == target_language:
            return TranslationResult(text=None, provider="none")

        try:
            import argostranslate.translate
        except Exception as exc:
            self._load_error = str(exc)
            return TranslationResult(
                text=None,
                provider="none",
                warning="Argos Translate is not installed, so translation was skipped.",
            )

        installed_languages = argostranslate.translate.get_installed_languages()
        from_language = self._find_language(installed_languages, source_language)
        to_language = self._find_language(installed_languages, target_language)

        if source_language == "auto" or from_language is None:
            guessed = self._guess_source(installed_languages, target_language)
            from_language = guessed

        if from_language is None or to_language is None:
            return TranslationResult(
                text=None,
                provider="argos-translate",
                warning=f"Argos package for {source_language}->{target_language} is not installed.",
            )

        translation = from_language.get_translation(to_language)
        if translation is None:
            return TranslationResult(
                text=None,
                provider="argos-translate",
                warning=f"Argos package for {from_language.code}->{target_language} is not installed.",
            )

        try:
            translated_text = translation.translate(text)
        except Exception as exc:
            self._runtime_error = str(exc)
            return TranslationResult(
                text=None,
                provider="argos-translate",
                warning="Translation is not ready, so only the transcript was saved.",
            )

        return TranslationResult(
            text=translated_text,
            provider="argos-translate",
        )

    def _can_import(self) -> bool:
        try:
            import argostranslate.translate  # noqa: F401
        except Exception as exc:
            self._load_error = str(exc)
            return False
        return True

    @staticmethod
    def _find_language(languages, code: str):
        for language in languages:
            if language.code == code:
                return language
        return None

    @staticmethod
    def _guess_source(languages, target_language: str):
        for language in languages:
            if language.code != target_language:
                return language
        return None


translator = ArgosTranslator()
