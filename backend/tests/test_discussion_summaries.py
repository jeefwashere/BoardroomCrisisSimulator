"""Personal summaries use authenticated evidence and never commit final answers."""

import asyncio
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

from backend.app.recordings import Recording
from backend.tests import test_gameplay as fixture
from backend.tests import test_individual_decisions as individual


class Generator:
    def __init__(self):
        self.prompts = []
        self.gate = asyncio.Event()
        self.gate.set()
        self.fail = False
        self.offline = False

    async def generate(self, prompt, fallback):
        self.prompts.append(prompt)
        await self.gate.wait()
        if self.fail:
            raise RuntimeError("SECRET provider detail")
        return (fallback, "offline") if self.offline else ("I will preserve the records.", "vertex")


class DiscussionSummaryTests(unittest.IsolatedAsyncioTestCase):
    client, view, action = individual.IndividualDecisionTests.client, individual.IndividualDecisionTests.view, individual.IndividualDecisionTests.action
    cedar = individual.IndividualDecisionTests.cedar

    async def asyncSetUp(self):
        await individual.IndividualDecisionTests.asyncSetUp(self)
        self.summary = self.app.state.discussion_summaries
        self.generator = Generator()
        self.summary.facilitation = self.generator
        self.summary.recordings.root = Path(self.enterContext(tempfile.TemporaryDirectory()))

    async def asyncTearDown(self):
        await self.summary.close()

    async def speaking(self):
        return await self.action(0, await self.cedar(), "briefing/finish")

    async def contribute(self, who, text):
        view = await self.view(who)
        response = await self.clients[who].post(self.path + "/contributions", json=fixture.command(
            phase_id=view["game"]["phase_id"], kind="answer", source="typed", text=text))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    async def sync(self, who=0, expected=200, **fields):
        view = await self.view(who)
        body = fixture.command(round_id=view["game"]["round_id"], **fields)
        response = await self.clients[who].post(self.path + "/discussion-summary", json=body)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    async def drain(self):
        await asyncio.gather(*list(self.summary.tasks))

    async def test_empty_and_repeated_evidence_never_create_duplicate_jobs(self):
        await self.speaking()
        self.assertEqual((await self.sync())["status"], "empty")
        self.assertEqual(self.generator.prompts, [])
        await self.contribute(0, "OWN: preserve records.")
        self.generator.gate.clear()
        first, second = await asyncio.gather(self.sync(), self.sync())
        self.assertEqual((first["status"], second["status"]), ("pending", "pending"))
        self.assertEqual(first["evidence_revision"], second["evidence_revision"])
        await asyncio.sleep(0)
        self.assertEqual(len(self.generator.prompts), 1)
        self.generator.gate.set()
        await self.drain()
        ready = await self.sync()
        self.assertEqual((ready["status"], ready["text"], ready["source"]),
                         ("ready", "I will preserve the records.", "vertex"))
        self.assertEqual(len(self.generator.prompts), 1)
        self.assertEqual(len((await self.view())["game"]["individual_decisions"] or {}), 0)
        self.assertEqual(len(self.rooms.require_room(UUID(ready["room_id"])).contributions), 1)

    async def test_finished_speech_automatically_drafts_without_committing_transcript(self):
        view = await self.speaking()
        room = self.rooms.require_room(UUID(view["room_id"]))
        item = Recording(uuid4(), room.room_id, UUID(self.ids[0]), UUID(view["game"]["round_id"]),
                         1, UUID(view["game"]["phase_id"]), 1000, 1030, datetime.now(timezone.utc),
                         status="review_required", transcript="OWN spoken proposal to verify backups.")
        self.summary.recordings.entries[item.recording_id] = item
        for hidden in (replace(item, recording_id=uuid4(), member_id=UUID(self.ids[2]), transcript="OTHER_OWNER_SECRET"),
                       replace(item, recording_id=uuid4(), round_id=uuid4(), transcript="OLD_ROUND_SECRET"),
                       replace(item, recording_id=uuid4(), room_id=uuid4(), transcript="OTHER_ROOM_SECRET")):
            self.summary.recordings.entries[hidden.recording_id] = hidden
        await self.sync()
        await self.drain()
        ready = await self.sync()
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["provisional_recording_count"], 1)
        self.assertIn(item.transcript, self.generator.prompts[0])
        for hidden in ("OTHER_OWNER_SECRET", "OLD_ROUND_SECRET", "OTHER_ROOM_SECRET"):
            self.assertNotIn(hidden, self.generator.prompts[0])
        self.assertIsNone(item.reviewed_text)
        self.assertEqual(item.status, "review_required")
        self.assertEqual(room.contributions, ())
        other = await self.sync(1)
        self.assertEqual(other["status"], "empty")
        self.assertEqual(other["provisional_recording_count"], 0)
        await self.summary.recordings.review(self.clients[0].headers["X-Boardroom-Session"], room.room_id, item.recording_id, item.transcript)
        reviewed = await self.sync()
        self.assertEqual(reviewed["provisional_recording_count"], 0)
        self.assertEqual(len(self.generator.prompts), 1)
        self.assertEqual(room.contributions, ())

    async def test_only_own_current_discussion_and_provisional_or_reviewed_recordings_are_evidence(self):
        view = await self.speaking()
        await self.contribute(0, "OWN_PUBLIC")
        await self.contribute(1, "OTHER_MEMBER_SECRET")
        room = self.rooms.require_room(UUID(view["room_id"]))
        own = room.contributions[0]
        room.contributions += (replace(own, contribution_id=uuid4(), phase="private_session", text="PRIVATE_SECRET"),
                               replace(own, contribution_id=uuid4(), phase="individual_decision", text="DECISION_SECRET"),
                               replace(own, contribution_id=uuid4(), round_id=uuid4(), text="OLD_ROUND_SECRET"))
        item = Recording(uuid4(), room.room_id, UUID(self.ids[0]), UUID(view["game"]["round_id"]),
                         1, UUID(view["game"]["phase_id"]), 1000, 1030, datetime.now(timezone.utc),
                         status="review_required", transcript="PROVISIONAL_OWN_SPEECH")
        self.summary.recordings.entries[item.recording_id] = item
        await self.sync()
        await self.drain()
        first = await self.sync()
        self.assertEqual(first["evidence_count"], 2)
        self.assertEqual(first["provisional_recording_count"], 1)
        self.assertIn("PROVISIONAL_OWN_SPEECH", self.generator.prompts[0])
        self.assertIn("OWN_PUBLIC", self.generator.prompts[0])
        for hidden in ("OTHER_MEMBER_SECRET", "PRIVATE_SECRET", "DECISION_SECRET", "OLD_ROUND_SECRET"):
            self.assertNotIn(hidden, self.generator.prompts[0])
        session = self.clients[0].headers["X-Boardroom-Session"]
        await self.summary.recordings.review(session, room.room_id, item.recording_id, "REVIEWED_OWN_SPEECH")
        await self.sync()
        await self.drain()
        after = await self.sync()
        self.assertEqual(after["evidence_count"], 2)
        self.assertEqual(after["provisional_recording_count"], 0)
        self.assertNotEqual(after["evidence_revision"], first["evidence_revision"])
        self.assertIn("REVIEWED_OWN_SPEECH", self.generator.prompts[1])
        other = await self.sync(1)
        await self.drain()
        other = await self.sync(1)
        self.assertEqual(other["evidence_count"], 1)
        self.assertNotIn("OWN_PUBLIC", self.generator.prompts[2])

    async def test_new_evidence_during_generation_discards_old_result_and_coalesces(self):
        await self.speaking()
        await self.contribute(0, "FIRST")
        self.generator.gate.clear()
        old = await self.sync()
        await asyncio.sleep(0)
        # This also proves provider waiting does not hold the room mutation lock.
        await asyncio.wait_for(self.contribute(0, "SECOND"), 2)
        newer = await self.sync()
        self.assertNotEqual(old["evidence_revision"], newer["evidence_revision"])
        self.assertIsNone(newer["text"])
        self.generator.gate.set()
        await self.drain()
        pending = await self.sync()
        self.assertEqual((pending["status"], pending["text"]), ("pending", None))
        await self.drain()
        latest = await self.sync()
        self.assertEqual(latest["status"], "ready")
        self.assertEqual(len(self.generator.prompts), 2)
        self.assertIn("SECOND", self.generator.prompts[1])

    async def test_failure_does_not_poll_retry_and_explicit_retry_is_idempotent(self):
        view = await self.speaking()
        await self.contribute(0, "Preserve my records.")
        self.generator.fail = True
        await self.sync()
        await self.drain()
        for _ in range(3):
            failed = await self.sync()
            self.assertEqual(failed["status"], "failed")
            self.assertNotIn("SECRET", failed["error"])
        self.assertEqual(len(self.generator.prompts), 1)
        body = fixture.command(round_id=view["game"]["round_id"], retry=True)
        await self.clients[0].post(self.path + "/discussion-summary", json=body)
        await self.drain()
        await self.clients[0].post(self.path + "/discussion-summary", json=body)
        await self.drain()
        self.assertEqual(len(self.generator.prompts), 2)
        conflict = await self.clients[0].post(self.path + "/discussion-summary", json={**body, "retry": False})
        self.assertEqual(conflict.status_code, 409)

    async def test_closed_phase_discards_pending_result_and_rejects_sync(self):
        view = await self.speaking()
        await self.contribute(0, "Preserve records.")
        self.generator.gate.clear()
        await self.sync()
        await asyncio.sleep(0)
        ended = await self.clients[0].post(self.path + "/end", json=fixture.command(phase_id=view["game"]["phase_id"]))
        self.assertEqual(ended.status_code, 200, ended.text)
        self.generator.gate.set()
        await self.drain()
        self.assertIsNone(next(iter(self.summary.entries.values())).text)
        await self.sync(expected=409)

    async def test_round_change_and_late_observer_cannot_receive_artifacts(self):
        view = await self.speaking()
        other = await self.client()
        joined = await other.post("/api/rooms/join", json=fixture.command(room_code=self.code, display_name="Observer", role_id="technology"))
        self.assertEqual(joined.status_code, 200, joined.text)
        forbidden = await other.post(self.path + "/discussion-summary", json=fixture.command(round_id=view["game"]["round_id"]))
        self.assertEqual(forbidden.status_code, 403)
        wrong = await self.clients[0].post(self.path + "/discussion-summary", json=fixture.command(round_id=str(uuid4())))
        self.assertEqual(wrong.status_code, 409)
        await self.contribute(0, "Own records.")
        self.generator.gate.clear()
        await self.sync()
        await asyncio.sleep(0)
        room = self.rooms.require_room(UUID(view["room_id"]))
        room.phase = replace(room.phase, state=replace(room.phase.state, round_id=uuid4()))
        self.generator.gate.set()
        await self.drain()
        self.assertIsNone(next(iter(self.summary.entries.values())).text)

    async def test_offline_fallback_is_labelled_exact_own_text_and_shutdown_cancels(self):
        await self.speaking()
        await self.contribute(0, "Exact own statement.")
        self.generator.offline = True
        await self.sync()
        await self.drain()
        ready = await self.sync()
        self.assertEqual((ready["text"], ready["source"]), ("Exact own statement.", "offline"))
        await self.contribute(0, "Another own statement.")
        self.generator.gate.clear()
        await self.sync()
        await self.summary.close()
        self.assertFalse(self.summary.tasks)
        self.assertEqual(next(iter(self.summary.entries.values())).status, "failed")

    async def test_real_generator_offline_fallback_can_explicitly_retry_without_repeated_paid_calls(self):
        view = await self.speaking()
        await self.contribute(0, "Exact own statement.")
        vertex = SimpleNamespace(configured=True, text=AsyncMock(side_effect=RuntimeError("SECRET")))
        self.facilitation.vertex = vertex
        self.facilitation.provider.configured = False
        self.summary.facilitation = self.facilitation
        await self.sync()
        await self.drain()
        offline = await self.sync()
        self.assertEqual((offline["status"], offline["source"], offline["text"]),
                         ("ready", "offline", "Exact own statement."))
        for _ in range(3):
            await self.sync()
        self.assertEqual(vertex.text.await_count, 1)
        body = fixture.command(round_id=view["game"]["round_id"], retry=True)
        await self.clients[0].post(self.path + "/discussion-summary", json=body)
        await self.drain()
        await self.clients[0].post(self.path + "/discussion-summary", json=body)
        await self.drain()
        self.assertEqual(vertex.text.await_count, 2)
        vertex.text.side_effect = None
        vertex.text.return_value = "I will preserve my exact statement."
        recovered = await self.sync(retry=True)
        self.assertEqual(recovered["status"], "pending")
        await self.drain()
        self.assertEqual((await self.sync())["source"], "vertex")


if __name__ == "__main__":
    unittest.main()
