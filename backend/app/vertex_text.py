"""Vertex Express Gemini text provider for the main backend.

Approved by the user (Nov 7 2026) for the advisory agents and AI drafted ballot
options. Models only write text; Rooms remains the game authority.

Reuses the playtest client constants and its persistent SQLite usage ledger
(`playtest/vertex.py`, `DollarBudget`). Every attempt reserves a row before the
request, so usage stays tracked even when the app cap is lifted.
"""

import asyncio
import json
import os
from pathlib import Path
import threading
import urllib.error
import urllib.request

from playtest.vertex import ENDPOINT, MODEL, THINKING, DollarBudget, NoRedirect, VertexError

DEFAULT_LEDGER = ".local/vertex/ledger.sqlite"
MAX_PROMPT_BYTES = 20000
EMBEDDING_ENDPOINT = "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-embedding-001:predict"
USAGE_KEYS = ("promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount")


def _flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_json_object(text: str) -> dict:
    """Parse one JSON object, tolerating a Markdown code fence around it."""
    if not isinstance(text, str):
        raise ValueError("Expected text")
    start = text.find("{")
    if start < 0:
        raise ValueError("Expected a JSON object")
    value, used = json.JSONDecoder().raw_decode(text[start:])
    if text[:start].strip().strip("`").strip().lower() not in {"", "json"}:
        raise ValueError("Unexpected leading model text")
    if text[start + used:].strip().strip("`").strip():
        raise ValueError("Unexpected trailing model text")
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return value


class VertexText:
    """Minimal Gemini generateContent client: one request per call, no automatic retries."""

    source = "vertex"

    def __init__(self, key: str | None = None, *, enabled: bool = True, ledger: str | Path = DEFAULT_LEDGER,
                 unlimited: bool = False, cap_cents: int = 2000, opener=None):
        self._key = key or ""
        self.enabled = bool(enabled and self._key)
        self.ledger = Path(ledger)
        self.unlimited = unlimited
        self.cap_cents = cap_cents
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self._budget = None
        self._lock = threading.Lock()
        self.last_error: str | None = None

    @classmethod
    def from_env(cls) -> "VertexText":
        key = os.getenv("GOOGLE_API_KEY") or os.getenv("VERTEX_API_KEY") or ""
        cap = os.getenv("BOARDROOM_VERTEX_CAP_CENTS", "2000")
        return cls(key, enabled=_flag("BOARDROOM_VERTEX_ENABLED", bool(key)),
                   ledger=os.getenv("BOARDROOM_VERTEX_LEDGER") or DEFAULT_LEDGER,
                   unlimited=_flag("BOARDROOM_VERTEX_UNLIMITED", False),
                   cap_cents=int(cap) if cap.isdigit() else 2000)

    @property
    def configured(self) -> bool:
        return self.enabled

    def budget(self) -> DollarBudget:
        # Created lazily so constructing the app never touches disk.
        with self._lock:
            if self._budget is None:
                self._budget = DollarBudget(self.ledger, min(max(self.cap_cents, 0), 2000))
                if self.unlimited and not self._budget.unlimited:
                    self._budget.authorize_unlimited()
            return self._budget

    def status(self) -> dict:
        return {"configured": self.configured, "provider": "Google Vertex AI", "model": MODEL,
                "thinking_level": THINKING, "last_error": self.last_error}

    def generate(self, prompt: str, *, json_output: bool = False, max_output_tokens: int = 1024,
                 timeout: float = 30, temperature: float = 0.4, think: bool = True) -> str:
        """Blocking call. Never raises provider bodies or credentials."""
        if not self.configured:
            raise VertexError("Vertex is not configured")
        if not isinstance(prompt, str) or not prompt or len(prompt.encode("utf-8")) > MAX_PROMPT_BYTES:
            raise ValueError("Vertex input limit exceeded")
        # Spoken lines skip thinking: measured on this model, LOW thinking spent 500+ tokens and 8 to 17 seconds on a
        # 60 word line (sometimes running out of tokens), while a zero thinking budget answered in about 3 seconds.
        thinking = {"thinkingLevel": THINKING} if think else {"thinkingBudget": 0}
        config = {"thinkingConfig": thinking, "maxOutputTokens": max_output_tokens, "temperature": temperature}
        if json_output:
            config["responseMimeType"] = "application/json"
        payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": config}
        budget = self.budget()
        ident = budget.reserve()
        request = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json", "x-goog-api-key": self._key})
        try:
            with self.opener.open(request, timeout=timeout) as response:
                data = json.load(response)
            usage = {k: v for k, v in data.get("usageMetadata", {}).items() if k in USAGE_KEYS and type(v) is int}
            if usage:
                budget.record(ident, usage)
            candidate = (data.get("candidates") or [{}])[0]
            if candidate.get("finishReason") != "STOP":
                raise VertexError("Vertex did not return a complete response")
            text = "".join(part.get("text", "") for part in candidate.get("content", {}).get("parts", [])
                           if not part.get("thought")).strip()
            if not text:
                raise VertexError("Vertex returned empty text")
            self.last_error = None
            return text
        except urllib.error.HTTPError as error:
            message = f"Vertex HTTP {error.code}"
            error.close()
            self.last_error = message
            raise VertexError(message) from None
        except Exception:
            self.last_error = "Vertex request failed or returned invalid output"
            raise VertexError(self.last_error) from None

    async def text(self, prompt: str, timeout: float = 30, max_output_tokens: int = 1024,
                   temperature: float = 0.4, think: bool = False) -> str:
        """Short spoken text (agent lines, AI replies, coach questions): no thinking unless asked, for speed."""
        return await asyncio.wait_for(asyncio.to_thread(
            self.generate, prompt, max_output_tokens=max_output_tokens, timeout=timeout,
            temperature=temperature, think=think), timeout + 1)

    def embed(self, texts: list[str], task: str = "RETRIEVAL_DOCUMENT", timeout: float = 10) -> list[list[float]]:
        """Blocking. Google gemini-embedding-001 vectors (768 dimensions), batched. Never raises provider bodies."""
        if not self.configured:
            raise VertexError("Vertex is not configured")
        vectors: list[list[float]] = []
        for start in range(0, len(texts), 20):
            batch = [{"content": text[:2000], "task_type": task} for text in texts[start:start + 20]]
            request = urllib.request.Request(EMBEDDING_ENDPOINT, data=json.dumps(
                {"instances": batch, "parameters": {"outputDimensionality": 768}}).encode(),
                headers={"Content-Type": "application/json", "x-goog-api-key": self._key})
            try:
                with self.opener.open(request, timeout=timeout) as response:
                    data = json.load(response)
                vectors += [[float(x) for x in item["embeddings"]["values"]] for item in data["predictions"]]
            except urllib.error.HTTPError as error:
                error.close()
                raise VertexError(f"Embedding HTTP {error.code}") from None
            except Exception:
                raise VertexError("Embedding request failed or returned invalid output") from None
        if len(vectors) != len(texts):
            raise VertexError("Embedding count mismatch")
        return vectors

    async def embeddings(self, texts: list[str], task: str = "RETRIEVAL_DOCUMENT", timeout: float = 10) -> list[list[float]]:
        return await asyncio.wait_for(asyncio.to_thread(self.embed, texts, task, timeout), timeout + 1)

    async def json(self, prompt: str, timeout: float = 30, max_output_tokens: int = 2048,
                   temperature: float = 0.4) -> dict:
        # Private coaching and rubric scoring pass temperature 0 for repeatable beta behaviour.
        raw = await asyncio.wait_for(asyncio.to_thread(
            self.generate, prompt, json_output=True, max_output_tokens=max_output_tokens, timeout=timeout,
            temperature=temperature), timeout + 1)
        return parse_json_object(raw)
