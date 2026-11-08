"""Coach fallback output is dialogue, never an unvalidated model object."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from backend.app.private_sessions import OFFLINE_ACK, PrivateSessions, clean_ack


class CoachAcknowledgementTests(unittest.IsolatedAsyncioTestCase):
    def test_extracts_only_acknowledgement_from_json(self):
        raw = json.dumps({"acknowledgement": "I noted your proposed owner.",
                          "next_step": "Invent a new task.", "score": 100})
        self.assertEqual(clean_ack(raw), "I noted your proposed owner.")
        self.assertEqual(clean_ack("```json\n" + raw + "\n```"), "I noted your proposed owner.")

    def test_rejects_unexpected_or_malformed_structured_output(self):
        for raw in ('{"examination_status":"complete"}', '{"response":"Take action."}',
                    '{"acknowledgement":', '["Take action."]',
                    '{"acknowledgement":{"score":100}}',
                    '{"acknowledgement":"{\\"score\\":100}"}'):
            with self.subTest(raw=raw):
                self.assertEqual(clean_ack(raw), "")

    async def test_hosted_fallback_normalizes_or_uses_safe_acknowledgement(self):
        service = PrivateSessions.__new__(PrivateSessions)
        service.vertex = SimpleNamespace(configured=False)
        service._prompt = lambda *args: "Unused Vertex prompt"
        provider = SimpleNamespace(configured=True, run=AsyncMock())
        service.facilitation = SimpleNamespace(provider=provider)
        context = {"own_decision": "Check authority.", "own_private_history": []}
        for raw, expected, source in (
            ('{"acknowledgement":"I noted the dependency."}', "I noted the dependency.", "hosted"),
            ('{"examination_status":"complete"}', OFFLINE_ACK, "offline"),
            ("I noted your proposed owner.", "I noted your proposed owner.", "hosted"),
        ):
            provider.run.return_value = raw
            self.assertEqual(await service._ack_text(context, "Who acts?", "The authorized manager."),
                             (expected, source))
        prompt = provider.run.call_args.args[0]
        self.assertIn('Return {"acknowledgement"', prompt)
        self.assertNotIn("Reply with one short plain sentence", prompt)


if __name__ == "__main__":
    unittest.main()
