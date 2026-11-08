"""Cedar Bridge T01 demo package: catalog admission, authored choices and complete paths."""

import asyncio
import json
import os
from pathlib import Path
import unittest
from uuid import UUID, uuid4

import httpx2 as httpx

from backend.app import simulation as sim
from backend.app.main import SESSION_HEADER, create_app
from backend.app.rooms import Rooms, StartSpec
from backend.app.scenarios import ScenarioCatalog

# Automated tests never make paid Vertex calls.
os.environ["BOARDROOM_VERTEX_ENABLED"] = "false"

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "scenarios/cedar_bridge_t01/v1"
OPTIONS = (
    ("controlled_continuity", "Controlled continuity", "continuity_with_checks", "controlled_continuity_with_checks"),
    ("technical_first", "Technical checks first", "paused_for_checks", "service_paused_pending_checks"),
    ("wait_for_director", "Wait for the director", "coordination_gap", "coordination_gap_awaiting_director"),
)
ROLES = ("ceo", "technology", "communications")


class Clock:
    def __init__(self, now=0.0):
        self.now = now

    def __call__(self):
        return self.now


class CedarBridgeCatalogTests(unittest.TestCase):
    def setUp(self):
        self.catalog = ScenarioCatalog()
        self.scenario = self.catalog.get("cedar_bridge_t01", 1)

    def test_default_catalog_admits_t01_alongside_cybersecurity_v3(self):
        self.assertIsNotNone(self.scenario)
        self.assertIsNotNone(self.catalog.get("maplecart_cybersecurity", 3))
        self.assertEqual([item.scenario_id for item in self.catalog.all()],
                         ["maplecart_cybersecurity", "cedar_bridge_t01"])
        self.assertEqual(len(self.scenario.content_sha256), 64)
        self.assertEqual(self.scenario.title,
                         "Cedar Bridge Community Services: service outage and unavailable director")

    def test_roles_timings_and_public_documents(self):
        self.assertEqual([role.role_id for role in self.scenario.roles],
                         ["ceo", "technology", "communications", "operations"])
        self.assertEqual([timing.profile_id for timing in self.scenario.timings], ["standard_18", "fast_15"])
        self.assertTrue(all(timing.result_seconds == 30 and timing.voting_seconds == 60
                            for timing in self.scenario.timings))
        documents = {document.id: document.text for document in self.scenario.public_documents}
        self.assertEqual(set(documents), {"briefing", "initial_evidence", "operations"})
        self.assertIn("No alternate incident coordinator is named", documents["operations"])
        self.assertIn("No data disclosure has been confirmed", documents["initial_evidence"])

    def test_single_node_has_exact_authored_options_and_custom_outcomes(self):
        self.assertEqual(len(self.scenario.nodes), 1)
        node = self.scenario.nodes[0]
        self.assertEqual(node.node_id, self.scenario.initial_node_id)
        self.assertEqual(tuple((item.option_id, item.label, item.outcome_id) for item in node.options),
                         tuple(option[:3] for option in OPTIONS))
        self.assertEqual(node.allowed_custom_outcome_ids, tuple(option[2] for option in OPTIONS))
        self.assertEqual(node.no_decision_outcome_id, "t01_no_decision")
        self.assertNotIn(node.no_decision_outcome_id, node.allowed_custom_outcome_ids)
        for outcome in node.outcomes:
            self.assertTrue(outcome.terminal)
            self.assertIsNone(outcome.next_node_id)
            self.assertLessEqual(len(outcome.summary), 500)

    def test_option_descriptions_match_the_roundtable_choices(self):
        from playtest.roundtable_scenario import DECISION
        authored = json.loads((PACKAGE / "scenario.json").read_text())["nodes"][0]["options"]
        self.assertEqual([(item["id"], item["label"], item["description"]) for item in authored],
                         [(item["id"], item["label"], item["proposal"]) for item in DECISION["options"]])


class CedarBridgeEngineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = Clock()
        self.rooms = Rooms(ScenarioCatalog(), self.clock, automatic=False)
        self.counter = 0

    async def started(self):
        self.counter += 1
        code = f"CBT{self.counter:03d}"
        sessions = tuple(self.rooms.session(None) for _ in range(3))
        host = await self.rooms.create(sessions[0], uuid4(), code, "Alex")
        second = await self.rooms.join(sessions[1], uuid4(), code, "Morgan")
        third = await self.rooms.join(sessions[2], uuid4(), code, "Sam")
        ids = (host.self_member_id, second.self_member_id, third.self_member_id)
        spec = StartSpec(code, "cedar_bridge_t01", 1, "standard_18", tuple(zip(ids, ROLES)), "authored")
        view = await self.rooms.start(sessions[0], host.room_id, uuid4(), spec)
        return view, sessions

    async def test_every_authored_and_no_decision_path_ends_in_one_round(self):
        expected = {option_id: (outcome_id, ending) for option_id, _, outcome_id, ending in OPTIONS}
        expected[None] = ("t01_no_decision", "no_board_decision")
        initial = dict(self.rooms.catalog.get("cedar_bridge_t01", 1).initial_facts)
        for choice, (outcome_id, ending) in expected.items():
            with self.subTest(choice=choice):
                view, sessions = await self.started()
                self.assertEqual(view.phase, "briefing")
                self.clock.now += 90
                state = await self.rooms.transition_internal(
                    view.room_id, uuid4(), view.game.phase_id, sim.BeginDecision())
                self.assertEqual(sim.current_node(state).node_id, "t01_response")
                event = sim.ResolvePrepared(choice) if choice else sim.ResolveNoDecision()
                state = await self.rooms.transition_internal(view.room_id, uuid4(), state.phase.phase_id, event)
                self.assertEqual(state.phase.kind, "ended")
                self.assertEqual(state.phase.ending_label, ending)
                self.assertEqual(state.round_number, 1)
                (record,) = state.history
                self.assertEqual((record.node_id, record.selected_option_id, record.outcome_id),
                                 ("t01_response", choice, outcome_id))
                self.assertEqual(dict(record.facts_before), initial)
                facts = dict(state.facts)
                self.assertEqual(facts["appointment_service"], "unavailable")
                self.assertEqual(facts["data_disclosure"], "not_confirmed")
                self.assertEqual(facts["restoration_promise"], "none")
                if choice == "controlled_continuity":
                    self.assertEqual(facts["paper_appointments"], "authorized")
                    self.assertEqual(facts["incident_coordinator"], "interim_appointed")
                else:
                    self.assertEqual(facts["paper_appointments"], "not_authorized")
                snapshot = await self.rooms.snapshot(sessions[0], view.room_id)
                self.assertEqual(snapshot.game.last_result, record)
                self.assertIsNone(snapshot.game.current_node)


class CedarBridgeHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.clock = Clock(1000.0)
        self.rooms = Rooms(ScenarioCatalog(), self.clock)
        self.app = create_app(rooms=self.rooms)
        self.clients = []

    async def client(self):
        client = await self.enterAsyncContext(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"))
        token = (await client.post("/api/tab-sessions", json={})).json()["session_token"]
        client.headers[SESSION_HEADER] = token
        return client

    async def test_public_catalog_lists_t01_without_private_fields(self):
        anonymous = await self.enterAsyncContext(httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"))
        response = await anonymous.get("/api/scenarios")
        self.assertEqual(response.status_code, 200, response.text)
        listed = {item["scenario_id"]: item for item in response.json()}
        self.assertIn("maplecart_cybersecurity", listed)
        cedar = listed["cedar_bridge_t01"]
        self.assertEqual(cedar["version"], 1)
        self.assertEqual([role["role_id"] for role in cedar["roles"]],
                         ["ceo", "technology", "communications", "operations"])
        self.assertEqual([timing["profile_id"] for timing in cedar["timings"]], ["standard_18", "fast_15"])
        for forbidden in ("preferred_option_id", "outcomes", "continuity_with_checks", "happy_path"):
            self.assertNotIn(forbidden, response.text)

    async def test_individual_decisions_replace_the_vote_and_end_the_game(self):
        ids = []
        for number, name in enumerate(("Alex", "Morgan", "Sam")):
            client = await self.client()
            self.clients.append(client)
            body = {"command_id": str(uuid4()), "room_code": "CEDAR1", "display_name": name}
            response = await client.post("/api/rooms" if number == 0 else "/api/rooms/join", json=body)
            self.assertIn(response.status_code, (200, 201), response.text)
            ids.append(response.json()["self_member_id"])
            room_id = response.json()["room_id"]
        path = "/api/rooms/" + room_id
        start = {"command_id": str(uuid4()), "room_code": "CEDAR1", "scenario_id": "cedar_bridge_t01",
                 "scenario_version": 1, "timing_profile": "standard_18", "ballot_source": "authored",
                 "players": [{"member_id": member, "role_id": role} for member, role in zip(ids, ROLES)]}
        response = await self.clients[0].post(path + "/start", json=start)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["game"]["scenario"]["scenario_id"], "cedar_bridge_t01")

        async def view():
            result = await self.clients[0].get(path)
            self.assertEqual(result.status_code, 200, result.text)
            return result.json()

        for _ in range(250):
            current = await view()
            self.assertNotEqual(current["phase"], "voting", current)
            if current["phase"] == "individual_decision":
                break
            self.assertNotEqual(current["phase"], "ended", current)
            self.clock.now += 5
            await asyncio.gather(*(client.get(path) for client in self.clients))
        else:
            self.fail("Individual decisions were never reached")
        for number, client in enumerate(self.clients):
            response = await client.post(path + "/rounds/" + current["game"]["round_id"] + "/decision", json={
                "command_id": str(uuid4()), "phase_id": current["game"]["phase_id"],
                "text": f"Decision {number}: controlled continuity with checks."})
            self.assertEqual(response.status_code, 200, response.text)
        # Cedar continues into the private Rounds 2 and 3; the host skip ends that phase.
        private = await view()
        self.assertEqual(private["phase"], "private_session", private)
        self.assertTrue(private["game"]["private_rounds"])
        response = await self.clients[0].post(path + "/rounds/" + private["game"]["round_id"] + "/skip-phase", json={
            "command_id": str(uuid4()), "phase_id": private["game"]["phase_id"]})
        self.assertEqual(response.status_code, 200, response.text)
        ended = await view()
        self.assertEqual(ended["phase"], "ended", ended)
        self.assertEqual(ended["game"]["ending_label"], "private_sessions_complete")
        self.assertEqual(ended["game"]["history"], [])
        evidence = await self.clients[0].get(path + "/evaluation-evidence")
        self.assertEqual(evidence.status_code, 200, evidence.text)
        self.assertEqual(UUID(evidence.json()["room_id"]), UUID(room_id))

if __name__ == "__main__":
    unittest.main()
