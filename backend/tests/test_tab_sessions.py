"""Independent tab guest identities and authenticated seat renaming."""

import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from backend.app.main import COOKIE_NAME, SESSION_HEADER, create_app
from backend.app.rooms import Rooms
from backend.app.scenarios import ScenarioCatalog
from backend.app import simulation as sim


def command(name, **extra):
    return {"command_id": str(uuid4()), "room_code": "TABS01", "display_name": name, **extra}


class TabSessionTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.rooms = Rooms(ScenarioCatalog(), lambda: self.now)
        self.client = self.enterContext(TestClient(create_app(rooms=self.rooms)))
        self.client.get("/api/session")
        self.cookie = self.client.cookies[COOKIE_NAME]

    def bootstrap(self, body=None):
        response = self.client.post("/api/tab-sessions", json=body or {})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ready")
        self.assertNotIn("set-cookie", response.headers)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self.client.cookies[COOKIE_NAME], self.cookie)
        return response.json()["session_token"]

    def header(self, token):
        return {SESSION_HEADER: token}

    def create(self, token):
        response = self.client.post("/api/rooms", json=command("Host"), headers=self.header(token))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def join(self, token, name, **extra):
        return self.client.post("/api/rooms/join", json=command(name, **extra), headers=self.header(token))

    def snapshot(self, token, room):
        response = self.client.get(f'/api/rooms/{room["room_id"]}', headers=self.header(token))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def ready(self):
        tokens = [self.bootstrap() for _ in range(3)]
        room = self.create(tokens[0])
        ids = [room["self_member_id"]]
        for index, token in enumerate(tokens[1:], 1):
            response = self.join(token, f"Player {index}")
            self.assertEqual(response.status_code, 200, response.text)
            ids.append(response.json()["self_member_id"])
        return tokens, room, ids

    def start(self, tokens, room, ids):
        response = self.client.post(f'/api/rooms/{room["room_id"]}/start', headers=self.header(tokens[0]), json={
            "command_id": str(uuid4()), "room_code": "TABS01", "scenario_id": "maplecart_cybersecurity",
            "scenario_version": 3, "timing_profile": "standard_18",
            "players": [{"member_id": member, "role_id": "ceo" if index == 0 else "security"}
                        for index, member in enumerate(ids)],
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def transition(self, token, room, event):
        view = self.snapshot(token, room)
        self.client.portal.call(self.rooms.transition_internal, UUID(room["room_id"]), uuid4(),
                                UUID(view["game"]["phase_id"]), event)
        return self.snapshot(token, room)

    def test_same_cookie_three_tabs_have_independent_seats_and_start(self):
        tokens, room, ids = self.ready()
        self.assertEqual(len(set(tokens)), 3)
        self.assertTrue(all(len(token) >= 40 for token in tokens))
        self.assertNotIn(self.cookie, tokens)
        self.assertEqual(len(set(ids)), 3)
        started = self.start(tokens, room, ids)
        self.assertEqual(started["game"]["eligible_member_ids"], ids)
        for token, member_id in zip(tokens, ids):
            snapshot = self.snapshot(token, room)
            self.assertEqual(snapshot["self_member_id"], member_id)
            self.assertNotIn(token, str(snapshot))
        legacy = self.client.get(f'/api/rooms/{room["room_id"]}')
        self.assertEqual(legacy.status_code, 403)

    def test_resume_refresh_keeps_identity_and_unknown_token_issues_fresh(self):
        token = self.bootstrap()
        room = self.create(token)
        self.assertEqual(self.bootstrap({"session_token": token}), token)
        with TestClient(create_app(rooms=self.rooms)) as refresh:
            response = refresh.get(f'/api/rooms/{room["room_id"]}', headers=self.header(token))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["self_member_id"], room["self_member_id"])
        replacement = self.bootstrap({"session_token": "unknown"})
        self.assertNotEqual(replacement, token)
        self.assertNotEqual(replacement, "unknown")
        self.assertEqual(self.client.get(f'/api/rooms/{room["room_id"]}', headers=self.header(replacement)).status_code, 403)
        with TestClient(create_app()) as restarted:
            response = restarted.post("/api/tab-sessions", json={"session_token": token})
            self.assertEqual(response.status_code, 200)
            self.assertNotEqual(response.json()["session_token"], token)
            self.assertNotIn("set-cookie", response.headers)

    def test_invalid_header_never_falls_back_to_valid_cookie_or_public_id(self):
        room = self.client.post("/api/rooms", json=command("Cookie host")).json()
        path = f'/api/rooms/{room["room_id"]}'
        self.assertEqual(self.client.get(path).status_code, 200)
        for value in ("unknown", "", room["self_member_id"], room["room_code"]):
            response = self.client.get(path, headers=self.header(value))
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["detail"]["code"], "session_required")
        self.assertEqual(self.client.get(path).json(), room)

    def test_names_do_not_reclaim_another_tabs_seat(self):
        host, other = self.bootstrap(), self.bootstrap()
        room = self.create(host)
        rejected = self.join(other, "  HOST  ")
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.json()["detail"]["code"], "name_taken")
        self.assertEqual(self.client.get(f'/api/rooms/{room["room_id"]}', headers=self.header(other)).status_code, 403)

    def test_tab_bootstrap_and_header_preserve_origin_restrictions(self):
        preflight = self.client.options("/api/rooms", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-boardroom-session",
        })
        self.assertEqual(preflight.status_code, 200)
        self.assertIn("x-boardroom-session", preflight.headers["access-control-allow-headers"].lower())
        self.assertEqual(preflight.headers["access-control-allow-origin"], "http://localhost:5173")
        rejected = self.client.post("/api/tab-sessions", json={}, headers={"Origin": "https://untrusted.example"})
        self.assertEqual(rejected.status_code, 403)
        self.assertEqual(rejected.json()["detail"]["code"], "origin_not_allowed")

    def test_rename_preserves_seat_and_receipts_without_reverting_later_name(self):
        token = self.bootstrap()
        room = self.create(token)
        seat_before = self.rooms.rooms[UUID(room["room_id"])].members[token]
        request = command("  Renamed  ")
        first = self.client.post("/api/rooms/join", json=request, headers=self.header(token))
        self.assertEqual(first.status_code, 200, first.text)
        renamed = first.json()
        self.assertEqual(renamed["self_member_id"], room["self_member_id"])
        self.assertEqual(renamed["host_member_id"], room["host_member_id"])
        self.assertEqual(renamed["room_version"], room["room_version"] + 1)
        self.assertEqual(len(renamed["members"]), 1)
        self.assertEqual(renamed["members"][0]["display_name"], "Renamed")
        self.assertEqual(self.rooms.rooms[UUID(room["room_id"])].members[token].joined_at, seat_before.joined_at)
        self.assertEqual(self.client.post("/api/rooms/join", json=request, headers=self.header(token)).json(), renamed)
        unchanged = self.join(token, "Renamed").json()
        self.assertEqual(unchanged["room_version"], renamed["room_version"])
        latest = self.join(token, "RENAMED").json()
        self.assertEqual(latest["room_version"], renamed["room_version"] + 1)
        self.assertEqual(self.client.post("/api/rooms/join", json=request, headers=self.header(token)).json(), renamed)
        self.assertEqual(self.snapshot(token, room), latest)
        changed_body = {**request, "display_name": "Third name"}
        self.assertEqual(self.client.post("/api/rooms/join", json=changed_body, headers=self.header(token)).status_code, 409)

    def test_rejected_rename_does_not_mutate_name_version_or_presence(self):
        tokens, room, _ = self.ready()
        state = self.rooms.rooms[UUID(room["room_id"])]
        before = state.members[tokens[1]]
        version = state.version
        self.now += 31
        for name, extra, status, code in (
            ("HOST", {}, 409, "name_taken"),
            ("New name", {"role_id": "finance"}, 422, "role_not_yet_allowed"),
        ):
            response = self.join(tokens[1], name, **extra)
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.json()["detail"]["code"], code)
            self.assertEqual(state.members[tokens[1]], before)
            self.assertEqual(state.version, version)
        for name in ("", "  ", "x" * 41, "A\x00B"):
            self.assertEqual(self.join(tokens[1], name).status_code, 422)
            self.assertEqual(state.members[tokens[1]], before)
            self.assertEqual(state.version, version)

    def test_active_rename_retains_roles_electorate_contributions_and_history(self):
        tokens, room, ids = self.ready()
        started = self.start(tokens, room, ids)
        phase_id = started["game"]["phase_id"]
        contribution = self.client.post(f'/api/rooms/{room["room_id"]}/contributions',
            headers=self.header(tokens[0]), json={"command_id": str(uuid4()), "phase_id": phase_id,
            "kind": "chat", "source": "typed", "text": "Keep this evidence."})
        self.assertEqual(contribution.status_code, 201)
        before = self.snapshot(tokens[0], room)
        renamed = self.join(tokens[0], "CEO renamed").json()
        self.assertEqual(renamed["game"], before["game"])
        self.assertEqual(renamed["host_member_id"], ids[0])
        self.assertEqual({key: renamed["members"][0][key] for key in ("member_id", "is_host", "role_id", "eligible_from_round", "eligible_current_round")},
                         {key: before["members"][0][key] for key in ("member_id", "is_host", "role_id", "eligible_from_round", "eligible_current_round")})
        rejected = self.join(tokens[0], "Rejected name", role_id="finance")
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.json()["detail"]["code"], "role_locked")
        self.assertEqual(self.snapshot(tokens[0], room), renamed)
        saved = self.client.get(f'/api/rooms/{room["room_id"]}/contributions', headers=self.header(tokens[0]))
        self.assertEqual(saved.json(), [contribution.json()])
        late = self.bootstrap()
        admitted = self.join(late, "Late", role_id="finance").json()
        late_renamed = self.join(late, "Late renamed").json()
        self.assertEqual(late_renamed["self_member_id"], admitted["self_member_id"])
        self.assertEqual(late_renamed["members"][-1]["eligible_from_round"], 2)
        self.assertFalse(late_renamed["members"][-1]["eligible_current_round"])
        self.assertEqual(late_renamed["game"]["eligible_member_ids"], ids)
        self.now += started["game"]["briefing_seconds"]
        self.transition(tokens[0], room, sim.BeginDecision())
        result = self.transition(tokens[0], room, sim.ResolvePrepared("contain_targeted"))
        renamed_result = self.join(tokens[1], "Result renamed").json()
        self.assertEqual(renamed_result["game"], result["game"])
        self.assertEqual(renamed_result["game"]["history"], result["game"]["history"])

    def test_ended_names_freeze_but_same_name_rejoin_and_receipt_still_work(self):
        tokens, room, ids = self.ready()
        started = self.start(tokens, room, ids)
        rename_request = command("Frozen name")
        renamed = self.client.post("/api/rooms/join", json=rename_request, headers=self.header(tokens[0])).json()
        self.now += started["game"]["briefing_seconds"]
        self.transition(tokens[0], room, sim.BeginDecision())
        for option in ("contain_targeted", "communicate_facts", "recover_staged"):
            final = self.transition(tokens[0], room, sim.ResolvePrepared(option))
            if final["phase"] != "ended":
                self.now += 30
                self.transition(tokens[0], room, sim.AdvanceResult())
        self.assertEqual(final["phase"], "ended")
        evidence_path = f'/api/rooms/{room["room_id"]}/evaluation-evidence'
        evidence = self.client.get(evidence_path, headers=self.header(tokens[0])).json()
        rejected = self.join(tokens[0], "Changed after end")
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.json()["detail"]["code"], "game_ended")
        self.assertEqual(self.join(tokens[0], "Frozen name").json(), final)
        self.assertEqual(self.client.post("/api/rooms/join", json=rename_request, headers=self.header(tokens[0])).json(), renamed)
        self.assertEqual(self.snapshot(tokens[0], room), final)
        self.assertEqual(self.client.get(evidence_path, headers=self.header(tokens[0])).json(), evidence)


if __name__ == "__main__":
    unittest.main()
