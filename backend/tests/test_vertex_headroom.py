import io
import json
import tempfile
import unittest
from pathlib import Path

from backend.app.vertex_text import THINKING_HEADROOM, VertexError, VertexText, complete_sentences


class FakeOpener:
    def __init__(self, reason: str, text: str):
        self.reason, self.text, self.sent = reason, text, None

    def open(self, request, timeout):
        self.sent = json.loads(request.data)
        body = {"candidates": [{"finishReason": self.reason, "content": {"parts": [{"text": self.text}]}}],
                "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5, "thoughtsTokenCount": 500}}
        return io.BytesIO(json.dumps(body).encode())


class VertexHeadroomTests(unittest.TestCase):
    def client(self, opener):
        folder = tempfile.mkdtemp()
        return VertexText("test-key", ledger=Path(folder) / "ledger.sqlite", unlimited=True, opener=opener)

    def test_thinking_gets_room_beyond_the_answer_cap(self):
        opener = FakeOpener("STOP", "A short complete answer.")
        self.assertEqual(self.client(opener).generate("prompt", max_output_tokens=600, think=False), "A short complete answer.")
        self.assertEqual(opener.sent["generationConfig"]["maxOutputTokens"], 600 + THINKING_HEADROOM)

    def test_cut_off_spoken_line_keeps_its_full_sentences(self):
        opener = FakeOpener("MAX_TOKENS", "The board should preserve evidence first. Then it should brief st")
        self.assertEqual(self.client(opener).generate("prompt", think=False), "The board should preserve evidence first.")

    def test_cut_off_json_still_fails(self):
        with self.assertRaises(VertexError):
            self.client(FakeOpener("MAX_TOKENS", '{"acknowledgement": "The board should preserve evidence first.')).generate(
                "prompt", json_output=True)

    def test_complete_sentences(self):
        self.assertEqual(complete_sentences("All done here."), "All done here.")
        self.assertEqual(complete_sentences("Short. cut"), "")


if __name__ == "__main__":
    unittest.main()
