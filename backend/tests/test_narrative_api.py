"""Independent HTTP acceptance checks for narrative evidence and narration."""

import asyncio
import json
import os
from threading import Event
import unittest
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

import httpx2 as httpx

from backend.app.main import COOKIE_NAME, create_app
from backend.app.narration import NarrationService
from backend.app.rooms import RoomError, Rooms
from backend.app.scenarios import ScenarioCatalog
from backend.app import simulation as sim


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def command(**fields):
    return {"command_id": str(uuid4()), **fields}


class NarrativeApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.enterContext(patch.dict(os.environ, {"BOARDROOM_TTS_ENABLED": "false"}))
        self.provider = self.enterContext(patch(
            "rehearsal.voice.ElevenSpeech.request", side_effect=AssertionError("Live provider forbidden")))
        self.clock = FakeClock()
        self.rooms = Rooms(ScenarioCatalog(), self.clock, automatic=False)
        self.media = NarrationService()
        self.app = create_app(rooms=self.rooms, narration_service=self.media)
        self.host = await self.client()
        response = await self.host.post("/api/rooms", json=command(
            room_code="NAR001", display_name="Host"))
        self.assertEqual(response.status_code, 201, response.text)
        self.room = response.json()
        self.room_id = UUID(self.room["room_id"])
        self.path = f'/api/rooms/{self.room["room_id"]}'
        self.clients = [self.host]
        self.member_ids = [self.room["self_member_id"]]
        for name in ("Second", "Third"):
            client = await self.client()
            joined = await client.post("/api/rooms/join", json=command(
                room_code=self.room["room_code"], display_name=name))
            self.assertEqual(joined.status_code, 200, joined.text)
            self.clients.append(client)
            self.member_ids.append(joined.json()["self_member_id"])

    async def asyncTearDown(self):
        self.provider.assert_not_called()

    async def client(self, *, initialized=True, app=None):
        async def dispatch(scope, receive, send):
            await self.app(scope, receive, send)

        client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app or dispatch), base_url="http://testserver")
        self.addAsyncCleanup(client.aclose)
        if initialized:
            self.assertEqual((await client.get("/api/session")).status_code, 200)
        return client

    async def start(self):
        response = await self.host.post(self.path + "/start", json=command(
            room_code=self.room["room_code"], scenario_id="maplecart_cybersecurity",
            scenario_version=3, timing_profile="standard_18",
            players=[{"member_id": member, "role_id": "ceo" if index == 0 else "security"}
                     for index, member in enumerate(self.member_ids)]))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def snapshot(self, client=None):
        response = await (client or self.host).get(self.path)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def transition(self, event):
        before = await self.snapshot()
        await self.rooms.transition_internal(self.room_id, uuid4(), UUID(before["game"]["phase_id"]), event)
        return await self.snapshot()

    async def decision(self):
        view = await self.start()
        self.assertEqual(view["phase"], "briefing")
        self.clock.now += view["game"]["briefing_seconds"]
        return await self.transition(sim.BeginDecision())

    async def result(self):
        await self.decision()
        view = await self.transition(sim.ResolvePrepared("contain_targeted"))
        self.assertEqual(view["phase"], "result")
        return view

    async def advance(self):
        self.clock.now += 30
        return await self.transition(sim.AdvanceResult())

    async def finish(self):
        view = await self.result()
        await self.advance()
        await self.transition(sim.ResolvePrepared("communicate_facts"))
        await self.advance()
        view = await self.transition(sim.ResolvePrepared("recover_staged"))
        self.assertEqual(view["phase"], "ended")
        return view

    def narration_path(self, view):
        return self.path + "/narration/" + view["game"]["narration"]["narration_id"]

    async def contribute(self, client, text, *, kind="chat", source="typed", phase_id=...):
        if phase_id is ...:
            view = await self.snapshot(client)
            phase_id = view["game"]["phase_id"] if view["game"] else None
        return await client.post(self.path + "/contributions", json=command(
            phase_id=phase_id, kind=kind, source=source, text=text))

    def enable_media(self, synthesizer):
        # Rebuild only the HTTP shell. Rooms and browser cookies remain shared.
        self.media = NarrationService(synthesizer)
        self.app = create_app(rooms=self.rooms, narration_service=self.media)

    async def test_active_projection_is_metric_free_and_hides_future_outcomes(self):
        started = await self.start()
        self.assertEqual(started["phase"], "briefing")
        self.assertIsNone(started["game"]["current_node"])
        self.assertIsNone(started["game"]["narration"])
        self.clock.now += 90
        decision = await self.transition(sim.BeginDecision())
        self.assertEqual(decision["game"]["current_node"]["node_id"], "containment")
        self.assertTrue(decision["game"]["current_node"]["options"])
        result = await self.transition(sim.ResolvePrepared("contain_targeted"))
        catalog = await self.host.get("/api/scenarios")
        self.assertEqual(catalog.status_code, 200)
        forbidden = {"nodes", "outcomes", "fact_updates", "no_decision_outcome_id",
                     "preferred_option_id", "initial_metrics", "metric_bounds", "metric_deltas",
                     "metrics", "applied_deltas", "api_key", "session", "cookie"}

        def inspect(value):
            if isinstance(value, dict):
                self.assertFalse(forbidden.intersection(value))
                for item in value.values():
                    inspect(item)
            elif isinstance(value, list):
                for item in value:
                    inspect(item)

        for view in (started, decision, result, catalog.json()):
            inspect(view)
            for client in self.clients:
                self.assertNotIn(client.cookies[COOKIE_NAME], json.dumps(view))
        routes = (await self.host.get("/openapi.json")).json()["paths"]
        self.assertFalse(any(any(word in route for word in ("resolve", "advance", "transition"))
                             for route in routes))
        for action in ("resolve", "advance", "transition"):
            response = await self.host.post(self.path + "/" + action, json=command(option_id="contain_wait"))
            self.assertEqual(response.status_code, 404)

    async def test_default_disabled_narration_preserves_exact_committed_caption(self):
        self.app = create_app(rooms=self.rooms)
        view = await self.result()
        path = self.narration_path(view)
        caption = view["game"]["last_result"]["text"]
        self.assertEqual(view["game"]["narration"]["text"], caption)
        for method, suffix in (("GET", ""), ("POST", "/prepare")):
            response = await self.host.request(method, path + suffix)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["text"], caption)
            self.assertEqual(response.json()["status"], "disabled")
        audio = await self.host.get(path + "/audio")
        self.assertEqual(audio.status_code, 404)
        self.assertEqual(audio.json()["detail"]["code"], "narration_not_ready")
        self.assertEqual((await self.snapshot())["game"]["history"], view["game"]["history"])

    async def test_anonymous_and_other_rooms_cannot_access_narrative_routes(self):
        view = await self.result()
        narration = self.narration_path(view)
        anonymous, outsider = await self.client(initialized=False), await self.client()
        requests = [("GET", self.path + "/contributions", None),
                    ("POST", self.path + "/contributions", command(
                        phase_id=view["game"]["phase_id"], kind="chat", source="typed", text="No access")),
                    ("GET", self.path + "/evaluation-evidence", None),
                    ("GET", narration, None), ("POST", narration + "/prepare", None),
                    ("GET", narration + "/audio", None),
                    ("POST", narration + "/delivery", {"event": "started"})]
        for client, expected in ((anonymous, 401), (outsider, 403)):
            for method, path, body in requests:
                with self.subTest(method=method, path=path, expected=expected):
                    response = await client.request(method, path, **({"json": body} if body else {}))
                    self.assertEqual(response.status_code, expected, response.text)

    async def test_every_member_shares_one_generation_and_audio(self):
        synthesize = Mock(return_value=b"shared-mp3")
        self.enable_media(synthesize)
        view = await self.result()
        path = self.narration_path(view)
        caption = view["game"]["narration"]["text"]
        responses = await asyncio.gather(*(client.post(path + "/prepare") for client in self.clients))
        for response in responses:
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["status"], "ready")
            self.assertEqual(response.json()["text"], caption)
        synthesize.assert_called_once_with(caption)
        for client in self.clients:
            audio = await client.get(path + "/audio")
            self.assertEqual(audio.status_code, 200, audio.text)
            self.assertEqual(audio.content, b"shared-mp3")
            self.assertEqual(audio.headers["content-type"], "audio/mpeg")
            self.assertEqual(audio.headers["cache-control"], "no-store")

    async def test_result_caption_and_audio_expire_exactly_at_thirty_seconds(self):
        self.enable_media(lambda text: b"audio")
        view = await self.result()
        path = self.narration_path(view)
        self.assertEqual((await self.host.post(path + "/prepare")).status_code, 200)
        self.clock.now += 29.999
        self.assertEqual((await self.host.get(path + "/audio")).status_code, 200)
        self.clock.now += 0.001
        self.assertEqual((await self.snapshot())["phase"], "result")
        self.assertIsNone((await self.snapshot())["game"]["narration"])
        for method, suffix, body in (("GET", "", None), ("POST", "/prepare", None),
                                     ("GET", "/audio", None), ("POST", "/delivery", {"event": "started"})):
            response = await self.host.request(method, path + suffix, **({"json": body} if body else {}))
            self.assertEqual(response.status_code, 410, response.text)
        advanced = await self.transition(sim.AdvanceResult())
        self.assertEqual(advanced["phase"], "decision")
        self.assertEqual((await self.host.get(path + "/audio")).status_code, 410)

    async def test_slow_generation_does_not_hold_room_lock_or_publish_stale_audio(self):
        began, release = Event(), Event()

        def synthesize(text):
            began.set()
            if not release.wait(3):
                raise RuntimeError("Test synthesis release timed out")
            return b"late-audio"

        self.enable_media(synthesize)
        view = await self.result()
        path = self.narration_path(view)
        pending = asyncio.create_task(self.host.post(path + "/prepare"))
        try:
            self.assertTrue(await asyncio.to_thread(began.wait, 1))
            self.clock.now += 30
            await asyncio.wait_for(self.rooms.transition_internal(
                self.room_id, uuid4(), UUID(view["game"]["phase_id"]), sim.AdvanceResult()), 1)
        finally:
            release.set()
        response = await asyncio.wait_for(pending, 2)
        self.assertEqual(response.status_code, 410, response.text)
        self.assertEqual((await self.host.get(path + "/audio")).status_code, 410)
        self.assertEqual((await self.snapshot())["phase"], "decision")

    async def test_delivery_requires_ready_audio_started_event_and_current_phase(self):
        self.enable_media(lambda text: b"audio")
        view = await self.result()
        path = self.narration_path(view)
        premature = await self.host.post(path + "/delivery", json={"event": "started"})
        self.assertEqual(premature.status_code, 409, premature.text)
        await self.host.post(path + "/prepare")
        premature = await self.host.post(path + "/delivery", json={"event": "completed"})
        self.assertEqual(premature.status_code, 409, premature.text)
        self.assertEqual(self.media.deliveries(self.room_id, UUID(view["game"]["narration"]["narration_id"])), ())
        for event in ("started", "completed"):
            response = await self.host.post(path + "/delivery", json={"event": event})
            self.assertEqual(response.status_code, 200, response.text)
        deliveries = self.media.deliveries(self.room_id, UUID(view["game"]["narration"]["narration_id"]))
        self.assertEqual([item.event for item in deliveries], ["started", "completed"])
        self.assertTrue(all(str(item.member_id) == self.member_ids[0] for item in deliveries))
        await self.advance()
        stale = await self.host.post(path + "/delivery", json={"event": "started"})
        self.assertEqual(stale.status_code, 410)

    async def test_synthesis_failure_retains_caption_and_game_without_retry_or_secrets(self):
        synthesize = Mock(side_effect=RuntimeError("private-provider-key /private/provider/cache"))
        self.enable_media(synthesize)
        before = await self.result()
        path = self.narration_path(before)
        for _ in range(2):
            response = await self.host.post(path + "/prepare")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["status"], "failed")
            self.assertEqual(response.json()["text"], before["game"]["narration"]["text"])
            self.assertNotIn("private-provider", response.text)
            self.assertNotIn("/private", response.text)
        synthesize.assert_called_once()
        self.assertEqual((await self.snapshot())["game"], before["game"])
        unavailable = await self.host.get(path + "/audio")
        self.assertEqual(unavailable.status_code, 404)
        self.assertEqual(unavailable.json()["detail"]["code"], "narration_not_ready")

    async def test_explicit_voice_initialization_failure_keeps_game_usable_as_text(self):
        config = {
            "BOARDROOM_TTS_ENABLED": "true",
            "BOARDROOM_VOICE_BUDGET_USD": "0.50",
            "BOARDROOM_TTS_USD_PER_1K": "0.01",
            "BOARDROOM_TTS_VOICE_ID": "selected_voice",
            "BOARDROOM_TTS_LEDGER": "/mock/explicit/shared.sqlite",
            "ELEVENLABS_API_KEY": "private-mock-provider-key",
        }
        with patch.dict(os.environ, config), patch(
                "rehearsal.voice.VoiceBudget", side_effect=OSError("private-mock-provider-key /mock/ledger")):
            self.app = create_app(rooms=self.rooms)
        view = await self.result()
        path = self.narration_path(view)
        response = await self.host.post(path + "/prepare")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "disabled")
        self.assertEqual(response.json()["text"], view["game"]["last_result"]["text"])
        self.assertNotIn("private-mock-provider-key", response.text)
        self.assertNotIn("/mock", response.text)
        self.assertEqual((await self.snapshot())["game"], view["game"])

    async def test_all_contributions_survive_resolution_and_final_evidence_freezes(self):
        expected = []
        lobby = await self.contribute(self.host, "Lobby context before roles")
        self.assertEqual(lobby.status_code, 201, lobby.text)
        expected.append(lobby.json())
        self.assertIsNone(expected[0]["phase_id"])
        await self.decision()
        for client, text, kind, source in (
            (self.host, "  Preserve logs and isolate finance  ", "answer", "typed"),
            (self.clients[1], "Wait for the promotion, my unselected answer", "answer", "typed"),
            (self.clients[2], "Reviewed speech: protect evidence before rebooting.", "chat", "speech"),
            (self.clients[1], "A second individual answer remains visible", "answer", "speech"),
        ):
            response = await self.contribute(client, text, kind=kind, source=source)
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(response.json()["text"], text)
            expected.append(response.json())
        first = await self.transition(sim.ResolvePrepared("contain_targeted"))
        identifiers = set(first["game"]["last_result"]["contribution_ids"])
        self.assertTrue({item["contribution_id"] for item in expected[1:]}.issubset(identifiers))
        result_chat = await self.contribute(self.clients[2], "Reflection after the selected outcome")
        self.assertEqual(result_chat.status_code, 201, result_chat.text)
        expected.append(result_chat.json())
        self.assertEqual((await self.host.get(self.path + "/evaluation-evidence")).status_code, 409)
        await self.advance()
        await self.transition(sim.ResolveNoDecision())
        await self.advance()
        ended = await self.transition(sim.ResolvePrepared("recover_staged"))
        evidence = await self.host.get(self.path + "/evaluation-evidence")
        self.assertEqual(evidence.status_code, 200, evidence.text)
        frozen = evidence.json()
        self.assertEqual(frozen["contributions"], expected)
        self.assertEqual(len(frozen["decisions"]), 3)
        self.assertEqual(frozen["decisions"][1]["resolution_kind"], "no_decision")
        self.assertEqual(len(frozen["members"]), 3)
        self.assertEqual(frozen["ending_label"], ended["game"]["ending_label"])
        self.assertEqual((await self.clients[1].get(self.path + "/contributions")).json(), expected)
        rejected = await self.contribute(self.host, "Must not alter final evidence")
        self.assertEqual(rejected.status_code, 409, rejected.text)
        late = await self.client()
        rejected_join = await late.post("/api/rooms/join", json=command(
            room_code=self.room["room_code"], display_name="After ending", role_id="security"))
        self.assertEqual(rejected_join.status_code, 409, rejected_join.text)
        self.assertEqual((await self.host.get(self.path + "/evaluation-evidence")).json(), frozen)

    async def test_contribution_receipts_replay_exactly_and_reject_conflicts_or_stale_phase(self):
        view = await self.decision()
        body = command(phase_id=view["game"]["phase_id"], kind="answer", source="typed",
                       text="One exact individual answer")
        first = await self.clients[1].post(self.path + "/contributions", json=body)
        retry = await self.clients[1].post(self.path + "/contributions", json=body)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(retry.status_code, 201, retry.text)
        self.assertEqual(retry.json(), first.json())
        conflict = await self.clients[1].post(self.path + "/contributions", json={**body, "text": "Changed"})
        self.assertEqual(conflict.status_code, 409, conflict.text)
        await self.transition(sim.ResolvePrepared("contain_targeted"))
        stale = await self.contribute(self.clients[1], "Old phase chat must be rejected",
                                      phase_id=view["game"]["phase_id"])
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual((await self.host.get(self.path + "/contributions")).json(), [first.json()])

    async def test_late_join_chat_is_retained_but_answer_waits_until_next_round(self):
        decision = await self.decision()
        initial_electorate = decision["game"]["eligible_member_ids"]
        late = await self.client()
        response = await late.post("/api/rooms/join", json=command(
            room_code=self.room["room_code"], display_name="Late", role_id="security"))
        self.assertEqual(response.status_code, 200, response.text)
        view = response.json()
        late_id = view["self_member_id"]
        self.assertEqual(view["game"]["eligible_member_ids"], initial_electorate)
        late_member = next(member for member in view["members"] if member["member_id"] == late_id)
        self.assertEqual(late_member["eligible_from_round"], 2)
        self.assertFalse(late_member["eligible_current_round"])
        chat = await self.contribute(late, "Observer context is still evidence", source="speech")
        self.assertEqual(chat.status_code, 201, chat.text)
        answer = await self.contribute(late, "Cannot vote this round", kind="answer")
        self.assertEqual(answer.status_code, 403, answer.text)
        await self.transition(sim.ResolvePrepared("contain_targeted"))
        next_round = await self.advance()
        self.assertIn(late_id, next_round["game"]["eligible_member_ids"])
        answer = await self.contribute(late, "Eligible individual answer now", kind="answer")
        self.assertEqual(answer.status_code, 201, answer.text)
        self.assertEqual((await late.get(self.path + "/contributions")).json(), [chat.json(), answer.json()])

    async def test_terminal_result_is_immediate_and_narration_does_not_expire(self):
        synthesize = Mock(return_value=b"final-audio")
        self.enable_media(synthesize)
        ended = await self.finish()
        self.assertEqual(ended["phase"], "ended")
        self.assertEqual(ended["game"]["ending_label"], "controlled_recovery_plan")
        self.assertEqual(len(ended["game"]["history"]), 3)
        path = self.narration_path(ended)
        self.clock.now += 3600
        prepared = await self.host.post(path + "/prepare")
        self.assertEqual(prepared.status_code, 200, prepared.text)
        self.assertEqual(prepared.json()["text"], ended["game"]["last_result"]["text"])
        self.assertEqual((await self.host.get(path + "/audio")).content, b"final-audio")
        current = await self.snapshot()
        self.assertEqual(current["game"]["phase_id"], ended["game"]["phase_id"])
        self.assertEqual(current["game"]["narration"], ended["game"]["narration"])
        with self.assertRaises(RoomError):
            await self.rooms.transition_internal(
                self.room_id, uuid4(), UUID(current["game"]["phase_id"]), sim.AdvanceResult())


if __name__ == "__main__":
    unittest.main()
