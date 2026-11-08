"""Vertex Express Gemini text provider for the main backend.

Approved by the user (Nov 7 2026) for the advisory agents and AI drafted ballot
options. Models only write text; Rooms remains the game authority.

Reuses the playtest client constants and its persistent SQLite usage ledger
(`playtest/vertex.py`, `DollarBudget`). Every attempt reserves a row before the
request, so usage stays tracked even when the app cap is lifted.
"""

import asyncio
import http.client
import json
import os
from pathlib import Path
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request

from playtest.vertex import ENDPOINT, MODEL, THINKING, DollarBudget, NoRedirect, VertexError

DEFAULT_LEDGER = ".local/vertex/ledger.sqlite"
MAX_PROMPT_BYTES = 20000
EMBEDDING_ENDPOINT = "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-embedding-001:predict"
# gemini-3.8-flash thinks before every answer even with a zero thinking budget (measured Nov 8 2026: 500 to 1970
# thought tokens for an 80 word line). Thought tokens count against maxOutputTokens, so a 600 token cap ended most
# spoken lines with MAX_TOKENS and the app fell back to the slow hosted model. The cap callers pass now bounds the
# answer only; this headroom covers the thinking.
THINKING_HEADROOM = 2048
USAGE_KEYS = ("promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount")
# Backup requests (seconds after the first): measured Nov 8 2026, about one Vertex request in eight hangs until its
# timeout while the rest answer in 2 to 4 s. A duplicate starts at each mark still without an answer (or at once when
# an attempt fails) and the first good answer wins, so a hung request costs seconds instead of the whole timeout.
TEXT_HEDGE_MARKS = (0.0, 4.0, 8.0)
# The first attempt of text() and json() uses this lighter model; backups use MODEL. Measured Nov 8 2026 on Vertex:
# a 40 word spoken line took 0.6 to 0.8 s on gemini-3.5-flash-lite with no thinking, against 1.9 to 5.7 s on
# gemini-3.8-flash (which still thinks for up to 500 tokens at a zero budget); coaching JSON took 0.8 to 1.0 s against
# 1.5 to 3.4 s. BOARDROOM_VERTEX_FAST_MODEL overrides it; an empty value or "off" uses MODEL for every attempt.
FAST_MODEL = "gemini-3.5-flash-lite"
JSON_HEDGE_MARKS = (0.0, 6.0, 12.0)


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


def complete_sentences(text: str) -> str:
    """The text up to its last full sentence, or empty when that would leave less than a short sentence."""
    end = max(text.rfind(mark) for mark in (". ", "! ", "? ", ".\n", "!\n", "?\n"))
    if text.rstrip().endswith((".", "!", "?")):
        return text.rstrip()
    return text[:end + 1].strip() if end >= 40 else ""


def _tls_context() -> ssl.SSLContext:
    try:
        import truststore
        context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except ImportError:
        context = ssl.create_default_context()
    context.set_alpn_protocols(["http/1.1"])
    return context


def _https_opener(context: ssl.SSLContext | None = None):
    return urllib.request.build_opener(
        NoRedirect(), urllib.request.HTTPSHandler(context=context or _tls_context()))


class _HTTPStatus(Exception):
    def __init__(self, code: int):
        super().__init__(code)
        self.code = code


class _KeepAlive:
    """One reused HTTPS connection per worker thread and host.

    urllib opens a new TCP and TLS connection for every request, measured at 0.26 to 0.75 s to Vertex before the
    model starts. Reusing the connection skips that on every call after the first. Redirects are refused, as with
    NoRedirect, and a reused connection the server already closed is reopened once.
    """

    STALE = (http.client.RemoteDisconnected, http.client.CannotSendRequest, http.client.BadStatusLine,
             ConnectionResetError, BrokenPipeError)

    def __init__(self, context: ssl.SSLContext):
        self.context = context
        self.local = threading.local()

    def post(self, url: str, body: bytes, headers: dict, timeout: float) -> dict:
        parts = urllib.parse.urlsplit(url)
        path = parts.path + (f"?{parts.query}" if parts.query else "")
        connections = self.local.__dict__.setdefault("connections", {})
        for attempt in (0, 1):
            connection = connections.get(parts.netloc)
            reused = connection is not None
            if connection is None:
                connection = http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=timeout,
                                                         context=self.context)
                connections[parts.netloc] = connection
            else:
                connection.timeout = timeout
                if connection.sock is not None:
                    connection.sock.settimeout(timeout)
            try:
                connection.request("POST", path, body=body, headers=headers)
                response = connection.getresponse()
                data = response.read()
            except self.STALE:
                connection.close()
                connections.pop(parts.netloc, None)
                if reused and attempt == 0:
                    continue
                raise
            except BaseException:
                connection.close()
                connections.pop(parts.netloc, None)
                raise
            if response.will_close:
                connection.close()
                connections.pop(parts.netloc, None)
            if response.status != 200:
                raise _HTTPStatus(response.status)
            return json.loads(data)
        raise http.client.RemoteDisconnected("connection closed")


class VertexText:
    """Minimal Gemini generateContent client: one request per call, no automatic retries."""

    source = "vertex"
    # text() and json() send their own backup requests, so callers need not hedge again.
    hedges = True

    def __init__(self, key: str | None = None, *, enabled: bool = True, ledger: str | Path = DEFAULT_LEDGER,
                 unlimited: bool = False, cap_cents: int = 2000, opener=None, fast_model: str | None = FAST_MODEL):
        self._key = key or ""
        self.fast_model = fast_model or None
        self.enabled = bool(enabled and self._key)
        self.ledger = Path(ledger)
        self.unlimited = unlimited
        self.cap_cents = cap_cents
        if opener is None:
            context = _tls_context()
            self.opener = _https_opener(context)
            self._pool: _KeepAlive | None = _KeepAlive(context)
        else:
            self.opener, self._pool = opener, None
        self._budget = None
        self._lock = threading.Lock()
        self.last_error: str | None = None

    @classmethod
    def from_env(cls) -> "VertexText":
        key = os.getenv("GOOGLE_API_KEY") or os.getenv("VERTEX_API_KEY") or ""
        cap = os.getenv("BOARDROOM_VERTEX_CAP_CENTS", "2000")
        fast = os.getenv("BOARDROOM_VERTEX_FAST_MODEL")
        fast = FAST_MODEL if fast is None else fast.strip()
        return cls(key, enabled=_flag("BOARDROOM_VERTEX_ENABLED", bool(key)),
                   ledger=os.getenv("BOARDROOM_VERTEX_LEDGER") or DEFAULT_LEDGER,
                   unlimited=_flag("BOARDROOM_VERTEX_UNLIMITED", False),
                   cap_cents=int(cap) if cap.isdigit() else 2000,
                   fast_model=None if fast.lower() in {"", "off", "none", "0", "false"} else fast)

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
                "fast_model": self.fast_model,
                "thinking_level": THINKING, "last_error": self.last_error}

    def _post(self, url: str, payload: dict, timeout: float) -> dict:
        body = json.dumps(payload).encode()
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._key}
        if self._pool is not None:
            return self._pool.post(url, body, headers, timeout)
        with self.opener.open(urllib.request.Request(url, data=body, headers=headers), timeout=timeout) as response:
            return json.load(response)

    def _check(self, prompt: str) -> None:
        if not self.configured:
            raise VertexError("Vertex is not configured")
        if not isinstance(prompt, str) or not prompt or len(prompt.encode("utf-8")) > MAX_PROMPT_BYTES:
            raise ValueError("Vertex input limit exceeded")

    def generate(self, prompt: str, *, json_output: bool = False, max_output_tokens: int = 1024,
                 timeout: float = 30, temperature: float = 0.4, think: bool = True, model: str | None = None) -> str:
        """Blocking call. Never raises provider bodies or credentials."""
        self._check(prompt)
        # Spoken lines skip thinking: measured on this model, LOW thinking spent 500+ tokens and 8 to 17 seconds on a
        # 60 word line (sometimes running out of tokens), while a zero thinking budget answered in about 3 seconds.
        thinking = {"thinkingLevel": THINKING} if think else {"thinkingBudget": 0}
        config = {"thinkingConfig": thinking, "maxOutputTokens": max_output_tokens + THINKING_HEADROOM,
                  "temperature": temperature}
        if json_output:
            config["responseMimeType"] = "application/json"
        payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": config}
        budget = self.budget()
        ident = budget.reserve()
        try:
            endpoint = ENDPOINT if not model or model == MODEL else ENDPOINT.replace(f"/models/{MODEL}:", f"/models/{model}:")
            data = self._post(endpoint, payload, timeout)
            usage = {k: v for k, v in data.get("usageMetadata", {}).items() if k in USAGE_KEYS and type(v) is int}
            if usage:
                budget.record(ident, usage)
            candidate = (data.get("candidates") or [{}])[0]
            text = "".join(part.get("text", "") for part in candidate.get("content", {}).get("parts", [])
                           if not part.get("thought")).strip()
            if candidate.get("finishReason") != "STOP":
                # A plain spoken line cut off mid answer is still usable up to its last full sentence; JSON is not.
                text = "" if json_output else complete_sentences(text)
                if not text:
                    raise VertexError("Vertex did not return a complete response")
            if not text:
                raise VertexError("Vertex returned empty text")
            self.last_error = None
            return text
        except (urllib.error.HTTPError, _HTTPStatus) as error:
            message = f"Vertex HTTP {error.code}"
            if isinstance(error, urllib.error.HTTPError):
                error.close()
            self.last_error = message
            raise VertexError(message) from None
        except Exception:
            self.last_error = "Vertex request failed or returned invalid output"
            raise VertexError(self.last_error) from None

    async def _hedged(self, call, timeout: float, marks: tuple[float, ...]):
        """First good result of call(remaining_seconds, attempt_index) from staggered attempts, within timeout.

        A hung attempt keeps its worker thread until its own socket timeout; nothing waits for it.
        """
        loop = asyncio.get_running_loop()
        start = loop.time()
        deadline = start + timeout
        starts = list(marks)
        pending: set[asyncio.Future] = set()
        last: BaseException | None = None
        try:
            while True:
                elapsed = loop.time() - start
                remaining = deadline - loop.time()
                if starts and remaining > 0.5 and (starts[0] <= elapsed or not pending):
                    starts.pop(0)
                    pending.add(asyncio.ensure_future(asyncio.to_thread(call, remaining, len(marks) - len(starts) - 1)))
                    continue
                if not pending:
                    raise last if isinstance(last, (VertexError, ValueError)) else VertexError("Vertex gave no answer")
                if remaining <= 0:
                    self.last_error = "Vertex timed out"
                    raise VertexError(self.last_error)
                wait = min(remaining, max(starts[0] - elapsed, 0)) if starts else remaining
                done, pending = await asyncio.wait(pending, timeout=wait, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    if task.exception() is None:
                        return task.result()
                    last = task.exception()
        finally:
            for task in pending:
                task.cancel()

    async def text(self, prompt: str, timeout: float = 30, max_output_tokens: int = 1024,
                   temperature: float = 0.4, think: bool = False) -> str:
        """Short spoken text (agent lines, AI replies, coach questions): no thinking unless asked, for speed."""
        self._check(prompt)
        return await self._hedged(lambda remaining, attempt: self.generate(
            prompt, max_output_tokens=max_output_tokens, timeout=remaining, temperature=temperature, think=think,
            model=self._model_for(attempt, think)), timeout, TEXT_HEDGE_MARKS)

    def _model_for(self, attempt: int, think: bool) -> str:
        return self.fast_model if attempt == 0 and self.fast_model and not think else MODEL

    def embed(self, texts: list[str], task: str = "RETRIEVAL_DOCUMENT", timeout: float = 10) -> list[list[float]]:
        """Blocking. Google gemini-embedding-001 vectors (768 dimensions), batched. Never raises provider bodies."""
        if not self.configured:
            raise VertexError("Vertex is not configured")
        vectors: list[list[float]] = []
        for start in range(0, len(texts), 20):
            batch = [{"content": text[:2000], "task_type": task} for text in texts[start:start + 20]]
            try:
                data = self._post(EMBEDDING_ENDPOINT, {"instances": batch,
                                                       "parameters": {"outputDimensionality": 768}}, timeout)
                vectors += [[float(x) for x in item["embeddings"]["values"]] for item in data["predictions"]]
            except (urllib.error.HTTPError, _HTTPStatus) as error:
                if isinstance(error, urllib.error.HTTPError):
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
                   temperature: float = 0.4, think: bool = False) -> dict:
        # Private coaching and rubric scoring pass temperature 0 for repeatable beta behaviour. No thinking by
        # default: measured Nov 8 2026 on a coaching JSON prompt, LOW thinking took 2.3 to 3.4 s and none 1.7 to 2.7 s
        # with the same valid output. A malformed answer counts as a failed attempt, so a backup request covers it.
        self._check(prompt)
        return await self._hedged(lambda remaining, attempt: parse_json_object(self.generate(
            prompt, json_output=True, max_output_tokens=max_output_tokens, timeout=remaining,
            temperature=temperature, think=think, model=self._model_for(attempt, think))), timeout, JSON_HEDGE_MARKS)
