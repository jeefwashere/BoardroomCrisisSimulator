"""Independent HTTP acceptance checks for first Start and briefing admission."""

import asyncio
import copy
import unittest
from uuid import uuid4

import httpx2 as httpx
from fastapi.testclient import TestClient

from backend.app.main import COOKIE_NAME, create_app


def command(**fields):
    return {"command_id": str(uuid4()), **fields}


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class StartApiTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.app = create_app(clock=self.clock)
        self.host = self.client()
        created = self.host.post("/api/rooms", json=command(display_name="Host", room_code="A01BCD"))
        self.assertEqual(created.status_code, 201, created.text)
        self.room = created.json()
        self.path = f'/api/rooms/{self.room["room_id"]}'
        self.clients = [self.host]
        self.ids = [self.room["self_member_id"]]

    def client(self):
        client = self.enterContext(TestClient(self.app))
        self.assertEqual(client.get("/api/session").status_code, 200)
        return client

    def add_player(self, name=None, **fields):
        client = self.client()
        response = client.post("/api/rooms/join", json=command(
            display_name=name or f"Player {len(self.clients)}",
            room_code=self.room["room_code"], **fields,
        ))
        self.assertEqual(response.status_code, 200, response.text)
        self.clients.append(client)
        self.ids.append(response.json()["self_member_id"])
        return client, response.json()

    def ready(self, count=3):
        while len(self.clients) < count:
            self.add_player()
        return self.start_body()

    def start_body(self):
        return command(
            room_code=self.room["room_code"], scenario_id="maplecart_cybersecurity",
            scenario_version=3, timing_profile="standard_18",
            players=[{"member_id": member_id, "role_id": "ceo" if index == 0 else "security"}
                     for index, member_id in enumerate(self.ids)],
        )

    def start(self, body=None, client=None):
        return (client or self.host).post(self.path + "/start", json=body or self.start_body())

    def snapshot(self):
        response = self.host.get(self.path)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    @staticmethod
    def structure(view):
        return {
            "phase": view["phase"], "version": view["room_version"], "game": view.get("game"),
            "members": [(member["member_id"], member.get("role_id"),
                         member.get("eligible_from_round"), member.get("eligible_current_round"))
                        for member in view["members"]],
        }

    def assert_rejected_without_transition(self, body, statuses=(409, 422, 404)):
        before = self.structure(self.snapshot())
        response = self.start(body)
        self.assertIn(response.status_code, statuses, response.text)
        self.assertEqual(self.structure(self.snapshot()), before)
        # Reusing a rejected command with repaired content must not hit a receipt conflict.
        repaired = self.start_body()
        repaired["command_id"] = body["command_id"]
        response = self.start(repaired)
        self.assertEqual(response.status_code, 200, response.text)

    def test_frontend_code_normalization_collision_and_required_code(self):
        response = self.client().post("/api/rooms", json=command(display_name="Other", room_code=" a01bcd "))
        self.assertEqual(response.status_code, 409, response.text)
        other = self.client().post("/api/rooms", json=command(display_name="Other", room_code=" xy01z9 "))
        self.assertEqual(other.status_code, 201, other.text)
        self.assertEqual(other.json()["room_code"], "XY01Z9")
        self.assertEqual(self.host.post("/api/rooms", json=command(display_name="Missing")).status_code, 422)

    def test_public_scenario_metadata_requires_no_session(self):
        anonymous = self.enterContext(TestClient(self.app))
        response = anonymous.get("/api/scenarios")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("maplecart_cybersecurity", response.text)
        self.assertIn("standard_18", response.text)
        self.assertNotIn("preferred_option_id", response.text)
        self.assertNotIn("outcomes", response.text)

    def test_two_members_fail_and_same_command_can_start_after_third_joins(self):
        self.ready(2)
        body = self.start_body()
        before = self.structure(self.snapshot())
        response = self.start(body)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.structure(self.snapshot()), before)
        self.add_player()
        fixed = self.start_body()
        fixed["command_id"] = body["command_id"]
        self.assertEqual(self.start(fixed).status_code, 200)

    def test_host_and_ceo_are_distinct_permissions(self):
        body = self.ready()
        body["players"][0]["role_id"] = "finance"
        body["players"][1]["role_id"] = "ceo"
        self.assertEqual(self.start(body, self.clients[1]).status_code, 403)
        started = self.start(body)
        self.assertEqual(started.status_code, 200, started.text)
        roles = {member["member_id"]: member["role_id"] for member in started.json()["members"]}
        self.assertEqual(roles[self.ids[0]], "finance")
        self.assertEqual(roles[self.ids[1]], "ceo")

    def test_start_requires_registered_authenticated_host(self):
        body = self.ready()
        anonymous = self.enterContext(TestClient(self.app))
        self.assertEqual(self.start(body, anonymous).status_code, 401)
        anonymous.cookies.set(COOKIE_NAME, "forged")
        self.assertEqual(self.start(body, anonymous).status_code, 401)
        self.assertEqual(self.start(body, self.client()).status_code, 403)
        self.assertEqual(self.snapshot()["phase"], "lobby")

    def test_bad_rosters_roles_scenario_and_code_are_atomic(self):
        # Each invalid request uses an independent room because its repaired retry starts it.
        mutations = {
            "wrong code": lambda body: body.update(room_code="ZZZZZZ"),
            "missing member": lambda body: body["players"].pop(),
            "duplicate member": lambda body: body["players"].append(copy.deepcopy(body["players"][1])),
            "unknown member": lambda body: body["players"][1].update(member_id=str(uuid4())),
            "unknown role": lambda body: body["players"][1].update(role_id="wizard"),
            "missing ceo": lambda body: body["players"][0].update(role_id="finance"),
            "duplicate ceo": lambda body: body["players"][1].update(role_id="ceo"),
            "unknown scenario": lambda body: body.update(scenario_id="missing_scenario"),
            "old version": lambda body: body.update(scenario_version=1),
            "unknown version": lambda body: body.update(scenario_version=999),
            "unknown timing": lambda body: body.update(timing_profile="missing_profile"),
        }
        for index, (label, mutate) in enumerate(mutations.items()):
            with self.subTest(case=label):
                host = self.client()
                created = host.post("/api/rooms", json=command(display_name="Host", room_code=f"T{index:05d}"))
                self.assertEqual(created.status_code, 201, created.text)
                self.host, self.room = host, created.json()
                self.path = f'/api/rooms/{self.room["room_id"]}'
                self.clients, self.ids = [host], [self.room["self_member_id"]]
                body = self.ready()
                mutate(body)
                self.assert_rejected_without_transition(body)

    def test_roster_becomes_stale_when_another_browser_joins(self):
        body = self.ready()
        self.add_player("Later lobby seat")
        self.assert_rejected_without_transition(body, (409,))

    def test_success_publishes_briefing_and_immutable_receipt(self):
        body = self.ready()
        first = self.start(body)
        self.assertEqual(first.status_code, 200, first.text)
        started = first.json()
        self.assertEqual(started["phase"], "briefing")
        self.assertEqual(started["room_version"], 4)
        game = started["game"]
        self.assertTrue(game["phase_id"])
        self.assertEqual(game["round_number"], 1)
        self.assertTrue(game["started_at"])
        self.assertEqual(game["timing_profile"], "standard_18")
        self.assertEqual(game["briefing_seconds"], 90)
        self.assertEqual(game["initial_node_id"], "containment")
        self.assertNotIn("initial_metrics", game)
        self.assertEqual(game["facts"]["verified_export_records"], 0)
        self.assertEqual(game["history"], [])
        self.assertEqual(game["scenario"]["scenario_id"], "maplecart_cybersecurity")
        self.assertEqual(game["scenario"]["version"], 3)
        self.assertRegex(game["scenario"]["content_sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(game["public_documents"])
        self.assertEqual(set(game["eligible_member_ids"]), set(self.ids))
        self.assertTrue(all(member["connected"] for member in started["members"]))
        self.assertTrue(all(member["eligible_from_round"] == 1 for member in started["members"]))
        self.assertTrue(all(member["eligible_current_round"] for member in started["members"]))
        reordered = copy.deepcopy(body)
        reordered["players"].reverse()
        self.assertEqual(self.start(reordered).json(), started)
        self.add_player("Late", role_id="finance")
        self.assertEqual(self.start(body).json(), started)
        current = self.snapshot()
        self.assertEqual(len(current["members"]), 4)
        self.assertEqual(current["game"]["phase_id"], game["phase_id"])
        self.assertEqual(set(current["game"]["eligible_member_ids"]), set(game["eligible_member_ids"]))
        self.assertEqual(self.start(self.start_body()).status_code, 409)
        changed = copy.deepcopy(body)
        changed["players"][1]["role_id"] = "finance"
        self.assertEqual(self.start(changed).status_code, 409)

    def test_presence_cutoff_is_strict_and_get_refreshes_member(self):
        body = self.ready()
        self.clock.now += 29.999
        self.assertTrue(all(member["connected"] for member in self.snapshot()["members"]))
        self.clock.now = 1030.0
        at_cutoff = self.snapshot()
        connected = {member["member_id"]: member["connected"] for member in at_cutoff["members"]}
        self.assertTrue(connected[self.ids[0]])
        self.assertFalse(connected[self.ids[1]])
        self.assertFalse(connected[self.ids[2]])
        self.assertEqual(self.start(body).status_code, 409)
        self.assertEqual(self.clients[1].get(self.path).status_code, 200)
        self.assertEqual(self.start(body).status_code, 409)
        self.assertEqual(self.clients[2].get(self.path).status_code, 200)
        self.assertEqual(self.start(body).status_code, 200)

    def test_successful_join_retry_refreshes_activity_but_keeps_receipt(self):
        receipts = []
        for name in ("Retry one", "Retry two"):
            client = self.client()
            request = command(display_name=name, room_code=self.room["room_code"])
            response = client.post("/api/rooms/join", json=request)
            self.assertEqual(response.status_code, 200, response.text)
            self.clients.append(client)
            self.ids.append(response.json()["self_member_id"])
            receipts.append((client, request, response.json()))
        self.clock.now += 29
        for client, request, original in receipts:
            retried = client.post("/api/rooms/join", json=request)
            self.assertEqual(retried.status_code, 200, retried.text)
            self.assertEqual(retried.json(), original)
        self.clock.now += 1
        started = self.start()
        self.assertEqual(started.status_code, 200, started.text)
        self.assertTrue(all(member["connected"] for member in started.json()["members"]))
        self.assertEqual(started.json()["room_version"], 4)

    def test_openapi_422_covers_domain_and_request_validation(self):
        schema = self.host.get("/openapi.json").json()
        for route in ("/api/rooms", "/api/rooms/join", "/api/rooms/{room_id}/start"):
            response_schema = schema["paths"][route]["post"]["responses"]["422"]["content"]["application/json"]["schema"]
            variants = response_schema.get("anyOf", response_schema.get("oneOf", []))
            refs = {variant.get("$ref", "").rsplit("/", 1)[-1] for variant in variants}
            self.assertEqual(refs, {"ErrorResponse", "ValidationErrorResponse"})
        malformed = self.host.post(self.path + "/start", json={})
        self.assertEqual(malformed.status_code, 422)
        self.assertIsInstance(malformed.json()["detail"], list)
        domain_rejection = self.client().post("/api/rooms/join", json=command(
            display_name="Role in lobby", room_code=self.room["room_code"], role_id="finance",
        ))
        self.assertEqual(domain_rejection.status_code, 422)
        self.assertIsInstance(domain_rejection.json()["detail"], dict)

    def test_failed_role_request_does_not_refresh_stale_member_activity(self):
        body = self.ready()
        self.clock.now += 31
        self.assertEqual(self.clients[1].get(self.path).status_code, 200)
        before = self.structure(self.snapshot())
        rejected = self.clients[2].post("/api/rooms/join", json=command(
            display_name="Player 2", room_code=self.room["room_code"], role_id="finance",
        ))
        self.assertEqual(rejected.status_code, 422, rejected.text)
        self.assertEqual(self.structure(self.snapshot()), before)
        start = self.start(body)
        self.assertEqual(start.status_code, 409, start.text)
        self.assertEqual(start.json()["detail"]["code"], "not_enough_active_members")
        snapshot = self.snapshot()
        stale = next(member for member in snapshot["members"] if member["member_id"] == self.ids[2])
        self.assertFalse(stale["connected"])
        self.assertIsNone(stale["role_id"])
        self.assertEqual(self.clients[2].get(self.path).status_code, 200)
        self.assertEqual(self.start(body).status_code, 200)

    def test_start_caller_counts_active_without_preceding_get(self):
        body = self.ready()
        self.clock.now += 31
        self.clients[1].get(self.path)
        self.clients[2].get(self.path)
        response = self.start(body)
        self.assertEqual(response.status_code, 200, response.text)
        host = next(member for member in response.json()["members"] if member["member_id"] == self.ids[0])
        self.assertTrue(host["connected"])

    def test_inactive_registered_member_is_not_removed_from_first_electorate(self):
        self.ready(4)
        self.clock.now += 31
        self.clients[1].get(self.path)
        self.clients[2].get(self.path)
        response = self.start()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()["game"]["eligible_member_ids"]), set(self.ids))
        fourth = next(member for member in response.json()["members"] if member["member_id"] == self.ids[3])
        self.assertFalse(fourth["connected"])
        self.assertTrue(fourth["eligible_current_round"])

    def test_lobby_role_rejected_and_late_join_requires_non_ceo_role(self):
        client = self.client()
        request = command(display_name="Lobby role", room_code=self.room["room_code"], role_id="finance")
        self.assertEqual(client.post("/api/rooms/join", json=request).status_code, 422)
        self.assertEqual(len(self.snapshot()["members"]), 1)
        self.assertEqual(self.start(self.ready()).status_code, 200)
        before = self.structure(self.snapshot())
        for fields in ({}, {"role_id": "ceo"}, {"role_id": "wizard"}):
            response = client.post("/api/rooms/join", json=command(
                display_name="Late", room_code=self.room["room_code"], **fields,
            ))
            self.assertIn(response.status_code, (409, 422), response.text)
            self.assertEqual(self.structure(self.snapshot()), before)

    def test_late_seat_and_extra_tab_preserve_role_and_eligibility(self):
        self.assertEqual(self.start(self.ready()).status_code, 200)
        electorate = set(self.ids)
        late, joined = self.add_player("Late", role_id="finance")
        late_id = joined["self_member_id"]
        tab = self.enterContext(TestClient(self.app))
        tab.cookies.update(late.cookies)
        for client, fields in ((late, {}), (tab, {"role_id": "finance"})):
            response = client.post("/api/rooms/join", json=command(
                display_name="Late", room_code=self.room["room_code"], **fields,
            ))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["self_member_id"], late_id)
            self.assertEqual(response.json()["room_version"], joined["room_version"])
        changed = tab.post("/api/rooms/join", json=command(
            display_name="Late", room_code=self.room["room_code"], role_id="security",
        ))
        self.assertEqual(changed.status_code, 409, changed.text)
        snapshot = self.snapshot()
        member = next(member for member in snapshot["members"] if member["member_id"] == late_id)
        self.assertEqual(member["role_id"], "finance")
        self.assertEqual(member["eligible_from_round"], 2)
        self.assertFalse(member["eligible_current_round"])
        self.assertEqual(set(snapshot["game"]["eligible_member_ids"]), electorate)
        existing = self.clients[1].post("/api/rooms/join", json=command(
            display_name="Player 1", room_code=self.room["room_code"], role_id="finance",
        ))
        self.assertEqual(existing.status_code, 409, existing.text)

    def test_thirty_members_start_with_shared_perspectives_and_full_room_stays_full(self):
        body = self.ready(30)
        response = self.start(body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["game"]["eligible_member_ids"]), 30)
        members = response.json()["members"]
        self.assertEqual(sum(member["role_id"] == "ceo" for member in members), 1)
        self.assertEqual(sum(member["role_id"] == "security" for member in members), 29)
        overflow = self.client().post("/api/rooms/join", json=command(
            display_name="Overflow", room_code=self.room["room_code"], role_id="finance",
        ))
        self.assertEqual(overflow.status_code, 409)

    def test_public_response_contains_no_future_outcomes_or_private_session(self):
        response = self.start(self.ready())
        self.assertEqual(response.status_code, 200, response.text)
        for forbidden in (
            "outcomes", "preferred_option_id", "allowed_custom_outcome_ids", "custom_rubric",
            "facilitator_script", "targeted_containment", "rushed_recovery", "staged_recovery_plan",
        ):
            self.assertNotIn(forbidden, response.text)
        for client in self.clients:
            self.assertNotIn(client.cookies[COOKIE_NAME], response.text)
        self.clock.now += 10000
        self.assertEqual(self.snapshot()["phase"], "ended")


class ConcurrentStartTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_frontend_code_collision_has_one_owner(self):
        app = create_app(clock=FakeClock())
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as first:
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as second:
                clients = [first, second]
                await asyncio.gather(*(client.get("/api/session") for client in clients))
                requests = [command(display_name=f"Host {index}", room_code="SHARED") for index in range(2)]
                responses = await asyncio.gather(*(
                    client.post("/api/rooms", json=request) for client, request in zip(clients, requests)
                ))
                self.assertEqual(sorted(response.status_code for response in responses), [201, 409])
                winner_index = next(index for index, response in enumerate(responses) if response.status_code == 201)
                loser_index = 1 - winner_index
                winner, loser = clients[winner_index], clients[loser_index]
                room = responses[winner_index].json()
                replay = await winner.post("/api/rooms", json=requests[winner_index])
                self.assertEqual(replay.status_code, 201, replay.text)
                self.assertEqual(replay.json(), room)
                self.assertEqual(len(room["members"]), 1)
                self.assertEqual(room["self_member_id"], room["host_member_id"])
                path = f'/api/rooms/{room["room_id"]}'
                self.assertEqual((await loser.get(path)).status_code, 403)
                self.assertEqual((await loser.post("/api/rooms", json=requests[loser_index])).status_code, 409)
                corrected = {**requests[loser_index], "room_code": "LOSER1"}
                recovered = await loser.post("/api/rooms", json=corrected)
                self.assertEqual(recovered.status_code, 201, recovered.text)
                self.assertNotEqual(recovered.json()["room_id"], room["room_id"])
                self.assertEqual((await loser.get(path)).status_code, 403)
                current = (await winner.get(path)).json()
                self.assertEqual(current, room)

    async def test_lobby_join_racing_start_has_only_atomic_admission_outcomes(self):
        app = create_app(clock=FakeClock())
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as host:
            await host.get("/api/session")
            created = await host.post("/api/rooms", json=command(display_name="Host", room_code="JOIN01"))
            self.assertEqual(created.status_code, 201, created.text)
            room = created.json()
            path = f'/api/rooms/{room["room_id"]}'
            ids = [room["self_member_id"]]
            for number in range(2):
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as player:
                    await player.get("/api/session")
                    joined = await player.post("/api/rooms/join", json=command(
                        display_name=f"Player {number}", room_code=room["room_code"],
                    ))
                    self.assertEqual(joined.status_code, 200, joined.text)
                    ids.append(joined.json()["self_member_id"])
            start_request = command(
                room_code=room["room_code"], scenario_id="maplecart_cybersecurity", scenario_version=3,
                timing_profile="standard_18",
                players=[{"member_id": member_id, "role_id": "ceo" if index == 0 else "security"}
                         for index, member_id in enumerate(ids)],
            )
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as newcomer:
                await newcomer.get("/api/session")
                join_request = command(display_name="Racing newcomer", room_code=room["room_code"])
                joined, started = await asyncio.gather(
                    newcomer.post("/api/rooms/join", json=join_request),
                    host.post(path + "/start", json=start_request),
                )
                self.assertIn((joined.status_code, started.status_code), ((200, 409), (422, 200)))
                current = (await host.get(path)).json()
                if joined.status_code == 200:
                    self.assertEqual(started.json()["detail"]["code"], "roster_changed")
                    self.assertEqual(current["phase"], "lobby")
                    self.assertIsNone(current["game"])
                    self.assertEqual(current["room_version"], 4)
                    self.assertEqual(len(current["members"]), 4)
                    self.assertTrue(all(member["role_id"] is None for member in current["members"]))
                    late_id = joined.json()["self_member_id"]
                    corrected = copy.deepcopy(start_request)
                    corrected["players"].append({"member_id": late_id, "role_id": "finance"})
                    recovered = await host.post(path + "/start", json=corrected)
                    self.assertEqual(recovered.status_code, 200, recovered.text)
                    self.assertEqual(recovered.json()["room_version"], 5)
                    self.assertEqual(set(recovered.json()["game"]["eligible_member_ids"]), {*ids, late_id})
                    self.assertTrue(all(member["eligible_from_round"] == 1 for member in recovered.json()["members"]))
                else:
                    self.assertEqual(current["phase"], "briefing")
                    self.assertEqual(current["room_version"], 4)
                    self.assertEqual(len(current["members"]), 3)
                    self.assertEqual(set(current["game"]["eligible_member_ids"]), set(ids))
                    self.assertEqual((await newcomer.get(path)).status_code, 403)
                    recovered = await newcomer.post("/api/rooms/join", json={**join_request, "role_id": "finance"})
                    self.assertEqual(recovered.status_code, 200, recovered.text)
                    final = recovered.json()
                    self.assertEqual(final["room_version"], 5)
                    self.assertEqual(len(final["members"]), 4)
                    self.assertEqual(final["game"], current["game"])
                    member = next(member for member in final["members"] if member["member_id"] == final["self_member_id"])
                    self.assertEqual(member["role_id"], "finance")
                    self.assertEqual(member["eligible_from_round"], 2)
                    self.assertFalse(member["eligible_current_round"])

    async def test_competing_start_commits_once_and_duplicate_commands_replay(self):
        app = create_app(clock=FakeClock())
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as host:
            await host.get("/api/session")
            created = await host.post("/api/rooms", json=command(display_name="Host", room_code="RACE01"))
            self.assertEqual(created.status_code, 201, created.text)
            room = created.json()
            ids = [room["self_member_id"]]
            for number in range(2):
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as player:
                    await player.get("/api/session")
                    joined = await player.post("/api/rooms/join", json=command(
                        display_name=f"Player {number}", room_code=room["room_code"],
                    ))
                    self.assertEqual(joined.status_code, 200, joined.text)
                    ids.append(joined.json()["self_member_id"])
            path = f'/api/rooms/{room["room_id"]}'
            body = command(
                room_code=room["room_code"], scenario_id="maplecart_cybersecurity", scenario_version=3,
                timing_profile="standard_18",
                players=[{"member_id": member_id, "role_id": "ceo" if index == 0 else "finance"}
                         for index, member_id in enumerate(ids)],
            )
            requests = [copy.deepcopy(body) for _ in range(8)]
            for request in requests[4:]:
                request["command_id"] = str(uuid4())
            responses = await asyncio.gather(*(host.post(path + "/start", json=request) for request in requests))
            successes = [response.json() for response in responses if response.status_code == 200]
            self.assertTrue(successes)
            self.assertGreaterEqual(sum(response.status_code == 409 for response in responses), 4)
            self.assertTrue(all(response.status_code in (200, 409) for response in responses))
            self.assertEqual(len({view["game"]["phase_id"] for view in successes}), 1)
            self.assertTrue(all(view["room_version"] == 4 for view in successes))
            snapshot = (await host.get(path)).json()
            self.assertEqual(snapshot["room_version"], 4)
            winner = next(request for request, response in zip(requests, responses) if response.status_code == 200)
            replay = await host.post(path + "/start", json=winner)
            self.assertEqual(replay.status_code, 200, replay.text)
            self.assertEqual(replay.json(), successes[0])


if __name__ == "__main__":
    unittest.main()
