"""Explicit lobby departure, closure and stale admission boundaries."""

import asyncio
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.app.main import SESSION_HEADER, create_app
from backend.app.rooms import RoomError, Rooms
from backend.app.scenarios import ScenarioCatalog


def command(**fields):
    return {"command_id": str(uuid4()), **fields}


class LobbyLeaveTests(unittest.TestCase):
    def setUp(self):
        self.client = self.enterContext(TestClient(create_app()))
        self.host = self.identity()
        self.guest = self.identity()
        self.creation = command(room_code="LEAVE1", display_name="Host")
        response = self.client.post("/api/rooms", headers=self.host, json=self.creation)
        self.assertEqual(response.status_code, 201)
        self.room = response.json()
        self.path = f'/api/rooms/{self.room["room_id"]}'
        self.admission = command(room_code="LEAVE1", display_name="Guest")
        response = self.client.post("/api/rooms/join", headers=self.guest, json=self.admission)
        self.assertEqual(response.status_code, 200)
        self.joined = response.json()

    def identity(self):
        response = self.client.post("/api/tab-sessions", json={})
        self.assertEqual(response.status_code, 200)
        return {SESSION_HEADER: response.json()["session_token"]}

    def snapshot(self):
        response = self.client.get(self.path, headers=self.host)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_guest_leave_removes_seat_and_exact_retry_changes_nothing(self):
        body = command()
        left = self.client.post(self.path + "/leave", headers=self.guest, json=body)
        self.assertEqual(left.status_code, 200)
        self.assertEqual(left.json()["status"], "left")
        current = self.snapshot()
        self.assertEqual([member["display_name"] for member in current["members"]], ["Host"])
        self.assertEqual(current["room_version"], self.joined["room_version"] + 1)
        self.assertEqual(self.client.post(self.path + "/leave", headers=self.guest, json=body).json(), left.json())
        self.assertEqual(self.snapshot()["room_version"], current["room_version"])
        self.assertEqual(self.client.get(self.path, headers=self.guest).status_code, 403)
        reused_name = self.client.post("/api/rooms/join", headers=self.identity(), json=command(room_code="LEAVE1", display_name="Guest"))
        self.assertEqual(reused_name.status_code, 200)

    def test_host_leave_closes_reads_admission_start_and_code_reuse(self):
        body = command()
        response = self.client.post(self.path + "/leave", headers=self.host, json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "closed")
        self.assertEqual(self.client.post(self.path + "/leave", headers=self.host, json=body).json(), response.json())
        for headers in (self.host, self.guest, self.identity()):
            read = self.client.get(self.path, headers=headers)
            self.assertEqual(read.status_code, 410)
            self.assertEqual(read.json()["detail"]["code"], "room_closed")
            joined = self.client.post("/api/rooms/join", headers=headers, json=command(room_code="LEAVE1", display_name="Guest"))
            self.assertEqual(joined.status_code, 410)
        self.assertEqual(self.client.post("/api/rooms/join", headers=self.guest, json=self.admission).status_code, 410)
        self.assertEqual(self.client.post("/api/rooms", headers=self.host, json=self.creation).status_code, 410)
        reused = self.client.post("/api/rooms", headers=self.host, json=command(room_code="LEAVE1", display_name="Host"))
        self.assertEqual(reused.status_code, 409)
        self.assertEqual(reused.json()["detail"]["code"], "room_code_taken")
        stale_start = self.start_body(self.joined)
        self.assertEqual(self.client.post(self.path + "/start", headers=self.host, json=stale_start).status_code, 410)

    def test_old_admission_cannot_restore_a_departed_seat_or_replace_a_new_one(self):
        body = command()
        left = self.client.post(self.path + "/leave", headers=self.guest, json=body).json()
        self.assertEqual(self.client.post("/api/rooms/join", headers=self.guest, json=self.admission).status_code, 403)
        rejoined = self.client.post("/api/rooms/join", headers=self.guest, json=command(room_code="LEAVE1", display_name="Guest")).json()
        self.assertNotEqual(rejoined["self_member_id"], self.joined["self_member_id"])
        old = self.client.post("/api/rooms/join", headers=self.guest, json=self.admission)
        self.assertEqual(old.status_code, 409)
        self.assertEqual(old.json()["detail"]["code"], "membership_changed")
        self.assertEqual(self.client.post(self.path + "/leave", headers=self.guest, json=body).json(), left)
        self.assertEqual(len(self.snapshot()["members"]), 2)

    def test_leave_requires_own_membership_and_rejects_target_ids_and_bad_origin(self):
        self.assertEqual(self.client.post(self.path + "/leave", json=command()).status_code, 401)
        self.assertEqual(self.client.post(self.path + "/leave", headers=self.identity(), json=command()).status_code, 403)
        self.assertEqual(self.client.post(self.path + "/leave", headers=self.guest, json=command(member_id=self.room["host_member_id"])).status_code, 422)
        self.assertEqual(self.client.post(self.path + "/leave", headers={**self.guest, "Origin": "https://unrelated.invalid"}, json=command()).status_code, 403)
        self.assertEqual(len(self.snapshot()["members"]), 2)

    def start_body(self, room):
        return command(room_code=room["room_code"], scenario_id="maplecart_cybersecurity", scenario_version=3,
                       timing_profile="standard_18", players=[{"member_id": member["member_id"], "role_id": "ceo" if member["is_host"] else "security"} for member in room["members"]])

    def test_departure_invalidates_an_old_start_roster(self):
        self.client.post("/api/rooms/join", headers=self.identity(), json=command(room_code="LEAVE1", display_name="Third"))
        before = self.snapshot()
        self.assertEqual(self.client.post(self.path + "/leave", headers=self.guest, json=command()).status_code, 200)
        stale = self.client.post(self.path + "/start", headers=self.host, json=self.start_body(before))
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["detail"]["code"], "roster_changed")
        self.assertEqual(self.snapshot()["phase"], "lobby")

    def start_game(self):
        third = self.identity()
        self.client.post("/api/rooms/join", headers=third, json=command(room_code="LEAVE1", display_name="Third"))
        started = self.client.post(self.path + "/start", headers=self.host, json=self.start_body(self.snapshot()))
        self.assertEqual(started.status_code, 200, started.text)
        return third

    def test_a_player_leaving_a_game_is_one_member_fewer(self):
        third = self.start_game()
        response = self.client.post(self.path + "/leave", headers=third, json=command())
        self.assertEqual((response.status_code, response.json()["status"]), (200, "left"))
        current = self.snapshot()
        self.assertEqual([member["display_name"] for member in current["members"]], ["Host", "Guest"])
        self.assertNotEqual(current["phase"], "ended")
        self.assertEqual(self.client.get(self.path, headers=third).status_code, 403)
        self.assertEqual(self.client.get(self.path, headers=self.guest).status_code, 200)

    def test_ceo_leaving_in_round_one_ends_the_game_and_deletes_the_room(self):
        self.start_game()
        response = self.client.post(self.path + "/leave", headers=self.host, json=command())
        self.assertEqual((response.status_code, response.json()["status"]), (200, "closed"))
        for headers in (self.host, self.guest):
            gone = self.client.get(self.path, headers=headers)
            self.assertEqual(gone.status_code, 410)
            self.assertEqual(gone.json()["detail"]["code"], "room_closed")
            self.assertIn("CEO left", gone.json()["detail"]["message"])
        rejoin = self.client.post("/api/rooms/join", headers=self.identity(), json=command(room_code="LEAVE1", display_name="Late"))
        self.assertEqual(rejoin.status_code, 404)

    def test_leave_intent_conflicts_and_other_rooms_are_isolated(self):
        other = self.client.post("/api/rooms", headers=self.guest, json=command(room_code="OTHER1", display_name="Guest")).json()
        body = command()
        self.client.post(self.path + "/leave", headers=self.guest, json=body)
        conflict = self.client.post(f'/api/rooms/{other["room_id"]}/leave', headers=self.guest, json=body)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["detail"]["code"], "command_conflict")
        self.assertEqual(self.client.get(f'/api/rooms/{other["room_id"]}', headers=self.guest).status_code, 200)

    def test_leaving_a_full_lobby_frees_a_seat(self):
        for index in range(8):  # host + guest + 8 = the 10 seat maximum
            response = self.client.post("/api/rooms/join", headers=self.identity(), json=command(room_code="LEAVE1", display_name=f"Player {index}"))
            self.assertEqual(response.status_code, 200)
        replacement = self.identity()
        admission = command(room_code="LEAVE1", display_name="Replacement")
        self.assertEqual(self.client.post("/api/rooms/join", headers=replacement, json=admission).status_code, 409)
        self.client.post(self.path + "/leave", headers=self.guest, json=command())
        response = self.client.post("/api/rooms/join", headers=replacement, json=admission)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["members"]), 10)


class ConcurrentLeaveTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_duplicate_leave_removes_only_one_seat(self):
        rooms = Rooms(ScenarioCatalog())
        host, guest = rooms.session(None), rooms.session(None)
        room = await rooms.create(host, uuid4(), "LEAVE1", "Host")
        await rooms.join(guest, uuid4(), "LEAVE1", "Guest")
        command_id = uuid4()
        receipts = await asyncio.gather(*(rooms.leave(guest, room.room_id, command_id) for _ in range(10)))
        self.assertTrue(all(receipt == receipts[0] for receipt in receipts))
        current = await rooms.snapshot(host, room.room_id)
        self.assertEqual(current.room_version, 3)
        self.assertEqual(len(current.members), 1)

    async def test_close_and_join_serialize_without_reopening_the_room(self):
        rooms = Rooms(ScenarioCatalog())
        host, guest = rooms.session(None), rooms.session(None)
        room = await rooms.create(host, uuid4(), "LEAVE1", "Host")
        results = await asyncio.gather(rooms.leave(host, room.room_id, uuid4()), rooms.join(guest, uuid4(), "LEAVE1", "Guest"), return_exceptions=True)
        self.assertEqual(results[0].status, "closed")
        for action in (rooms.snapshot(host, room.room_id), rooms.join(guest, uuid4(), "LEAVE1", "Guest")):
            with self.assertRaises(RoomError) as failure:
                await action
            self.assertEqual(failure.exception.code, "room_closed")
