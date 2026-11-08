"""Backup requests and connection reuse in the Vertex client, with no network requests."""

import asyncio
import io
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from backend.app import vertex_text
from backend.app.vertex_text import VertexError, VertexText


def answer(text):
    return io.BytesIO(json.dumps({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": text}]}}],
                                  "usageMetadata": {"promptTokenCount": 1}}).encode())


class ScriptedOpener:
    """Each call takes the next scripted behaviour: ('hang', seconds), ('fail',) or ('ok', text)."""

    def __init__(self, *script):
        self.script, self.calls, self.lock = list(script), 0, threading.Lock()

    def open(self, request, timeout):
        with self.lock:
            self.urls = getattr(self, "urls", []) + [request.full_url]
            step = self.script[min(self.calls, len(self.script) - 1)]
            self.calls += 1
        if step[0] == "hang":
            time.sleep(step[1])
            raise TimeoutError("hung")
        if step[0] == "fail":
            raise ConnectionError("refused")
        return answer(step[1])


class VertexHedgingTests(unittest.IsolatedAsyncioTestCase):
    def client(self, opener):
        return VertexText("test-key", ledger=Path(tempfile.mkdtemp()) / "ledger.sqlite", unlimited=True, opener=opener)

    async def test_a_hung_request_is_overtaken_by_a_backup(self):
        original = vertex_text.TEXT_HEDGE_MARKS
        vertex_text.TEXT_HEDGE_MARKS = (0.0, 0.1, 0.2)
        try:
            opener = ScriptedOpener(("hang", 1.0), ("ok", "Backup answer."))
            started = time.monotonic()
            self.assertEqual(await self.client(opener).text("prompt", 5), "Backup answer.")
            self.assertLess(time.monotonic() - started, 0.8)
            self.assertEqual(opener.calls, 2)
        finally:
            vertex_text.TEXT_HEDGE_MARKS = original

    async def test_a_failed_request_starts_the_backup_at_once(self):
        opener = ScriptedOpener(("fail",), ('ok', '{"a": 1}'))
        started = time.monotonic()
        self.assertEqual(await self.client(opener).json("prompt", 5), {"a": 1})
        self.assertLess(time.monotonic() - started, 1.0)

    async def test_malformed_json_counts_as_a_failed_attempt(self):
        opener = ScriptedOpener(("ok", "not json"), ("ok", '{"a": 2}'))
        self.assertEqual(await self.client(opener).json("prompt", 5), {"a": 2})

    async def test_every_attempt_failing_raises_without_details(self):
        opener = ScriptedOpener(("fail",))
        with self.assertRaises(VertexError) as caught:
            await self.client(opener).text("prompt", 5)
        self.assertNotIn("test-key", str(caught.exception))
        self.assertEqual(opener.calls, 3)

    async def test_first_attempt_uses_the_fast_model_and_backups_the_main_model(self):
        opener = ScriptedOpener(("fail",), ("ok", "Main model answer."))
        self.assertEqual(await self.client(opener).text("prompt", 5), "Main model answer.")
        self.assertIn(f"/models/{vertex_text.FAST_MODEL}:", opener.urls[0])
        self.assertIn(f"/models/{vertex_text.MODEL}:", opener.urls[1])

    def test_fast_model_can_be_turned_off_in_settings(self):
        from unittest.mock import patch
        import os
        with patch.dict(os.environ, {"GOOGLE_API_KEY": "k", "BOARDROOM_VERTEX_FAST_MODEL": "off"}):
            self.assertIsNone(VertexText.from_env().fast_model)
        with patch.dict(os.environ, {"GOOGLE_API_KEY": "k"}):
            os.environ.pop("BOARDROOM_VERTEX_FAST_MODEL", None)
            self.assertEqual(VertexText.from_env().fast_model, vertex_text.FAST_MODEL)

    async def test_unconfigured_client_sends_nothing(self):
        opener = ScriptedOpener(("ok", "x"))
        with self.assertRaises(VertexError):
            await VertexText("", opener=opener).text("prompt", 5)
        self.assertEqual(opener.calls, 0)


class FakeResponse:
    def __init__(self, status=200, close=False):
        self.status, self.will_close = status, close

    def read(self):
        return b'{"ok": true}'


class FakeConnection:
    made = 0

    def __init__(self, host, port, timeout, context):
        FakeConnection.made += 1
        self.sock, self.closed, self.responses = None, False, []

    def request(self, method, path, body, headers):
        self.path = path

    def getresponse(self):
        return FakeResponse()

    def close(self):
        self.closed = True


class KeepAliveTests(unittest.TestCase):
    def test_one_connection_is_reused_for_later_requests(self):
        original = vertex_text.http.client.HTTPSConnection
        vertex_text.http.client.HTTPSConnection = FakeConnection
        FakeConnection.made = 0
        try:
            pool = vertex_text._KeepAlive(context=None)
            for _ in range(3):
                self.assertEqual(pool.post("https://example.invalid/v1/x:go", b"{}", {}, 5), {"ok": True})
            self.assertEqual(FakeConnection.made, 1)
        finally:
            vertex_text.http.client.HTTPSConnection = original

    def test_error_status_and_redirect_are_refused(self):
        original = vertex_text.http.client.HTTPSConnection

        class Redirecting(FakeConnection):
            def getresponse(self):
                return FakeResponse(302)

        vertex_text.http.client.HTTPSConnection = Redirecting
        try:
            with self.assertRaises(vertex_text._HTTPStatus):
                vertex_text._KeepAlive(context=None).post("https://example.invalid/x", b"{}", {}, 5)
        finally:
            vertex_text.http.client.HTTPSConnection = original


if __name__ == "__main__":
    unittest.main()
