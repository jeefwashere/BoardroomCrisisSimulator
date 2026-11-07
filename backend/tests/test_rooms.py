"""Acceptance checks for the first lobby capability, without provider calls."""

import asyncio
from itertools import count
import unittest
from uuid import uuid4

import httpx2 as httpx
from fastapi.testclient import TestClient

from backend.app.main import COOKIE_NAME, create_app


code_counter = count()


def command(name, **extra):
    return {"command_id": str(uuid4()), "display_name": name, "room_code": f"{next(code_counter):06d}", **extra}


class RoomApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.host = self.new_client()

    def new_client(self):
        client = self.enterContext(TestClient(self.app))
        self.assertEqual(client.get("/api/session").status_code, 200)
        return client

    def create(self, name="Ricardo"):
        response = self.host.post("/api/rooms", json=command(name))
        self.assertEqual(response.status_code, 201)
        return response.json()

    def join(self, client, room, name, **extra):
        return client.post("/api/rooms/join", json=command(name, room_code=room["room_code"], **extra))

    def test_health_docs_and_openapi(self):
        self.assertEqual(self.host.get("/api/health").json(), {"status": "ok", "storage": "memory"})
        self.assertEqual(self.host.get("/docs").status_code, 200)
        schema = self.host.get("/openapi.json").json()
        self.assertIn("/api/rooms/join", schema["paths"])
        self.assertEqual(schema["paths"]["/api/session"]["get"].get("security", []), [])
        self.assertEqual(schema["components"]["securitySchemes"]["APIKeyCookie"]["in"], "cookie")
        self.assertIn("409", schema["paths"]["/api/rooms"]["post"]["responses"])

    def test_create_counts_host_seat_and_hides_credentials(self):
        room = self.create("  Ricardo  ")
        self.assertEqual(len(room["members"]), 1)
        self.assertEqual(room["host_member_id"], room["self_member_id"])
        self.assertEqual(room["members"][0]["display_name"], "Ricardo")
        self.assertTrue(room["members"][0]["is_host"])
        self.assertEqual((room["phase"], room["capacity"], room["room_version"]), ("lobby", 30, 1))
        self.assertNotIn(self.host.cookies[COOKIE_NAME], str(room))

    def test_cookie_bootstrap_is_stable_and_private(self):
        before = self.host.cookies[COOKIE_NAME]
        response = self.host.get("/api/session")
        self.assertEqual(self.host.cookies[COOKIE_NAME], before)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("SameSite=lax", response.headers["set-cookie"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn(before, response.text)
        with TestClient(create_app(secure_cookie=True), base_url="https://testserver") as secure:
            self.assertIn("Secure", secure.get("/api/session").headers["set-cookie"])

    def test_three_distinct_clients_share_member_list(self):
        room = self.create()
        for name in ("Jeff", "Arjun"):
            response = self.join(self.new_client(), room, name)
            self.assertEqual(response.status_code, 200)
            self.assertNotEqual(response.json()["self_member_id"], room["self_member_id"])
        snapshot = self.host.get(f'/api/rooms/{room["room_id"]}').json()
        self.assertEqual([member["display_name"] for member in snapshot["members"]], ["Ricardo", "Jeff", "Arjun"])
        self.assertEqual(snapshot["room_version"], 3)

    def test_missing_forged_and_unrelated_sessions_cannot_read(self):
        room = self.create()
        path = f'/api/rooms/{room["room_id"]}'
        anonymous = self.enterContext(TestClient(self.app))
        self.assertEqual(anonymous.get(path).status_code, 401)
        anonymous.cookies.set(COOKIE_NAME, "forged")
        self.assertEqual(anonymous.get(path).status_code, 401)
        self.assertEqual(self.new_client().get(path).status_code, 403)
        self.assertEqual(self.host.get(f"/api/rooms/{uuid4()}").status_code, 404)
        self.assertEqual(anonymous.post("/api/rooms", json=command("Intruder")).status_code, 401)

    def test_trimmed_casefold_names_are_unique_but_not_credentials(self):
        room = self.create("Straße")
        response = self.join(self.new_client(), room, "  STRASSE  ")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "name_taken")
        self.assertEqual(self.new_client().get(f'/api/rooms/{room["room_id"]}').status_code, 403)

    def test_room_codes_ignore_case_and_outer_spaces(self):
        room = self.create()
        response = self.new_client().post("/api/rooms/join", json=command(
            "Jeff", room_code=f'  {room["room_code"].lower()}  ',
        ))
        self.assertEqual(response.status_code, 200)
        unknown = "AAAAAA" if room["room_code"] != "AAAAAA" else "BBBBBB"
        response = self.new_client().post("/api/rooms/join", json=command("Other", room_code=unknown))
        self.assertEqual(response.status_code, 404)

    def test_exact_retries_return_original_receipt(self):
        request = command("Ricardo")
        first = self.host.post("/api/rooms", json=request)
        self.assertEqual(self.host.post("/api/rooms", json=request).json(), first.json())
        room = first.json()
        player = self.new_client()
        request = command("Jeff", room_code=room["room_code"])
        joined = player.post("/api/rooms/join", json=request).json()
        self.join(self.new_client(), room, "Arjun")
        self.assertEqual(player.post("/api/rooms/join", json=request).json(), joined)
        current = player.get(f'/api/rooms/{room["room_id"]}').json()
        self.assertEqual(len(current["members"]), 3)
        self.assertGreater(current["room_version"], joined["room_version"])

    def test_reused_command_with_changed_intent_conflicts(self):
        request = command("Ricardo")
        room = self.host.post("/api/rooms", json=request).json()
        request["display_name"] = "Other"
        self.assertEqual(self.host.post("/api/rooms", json=request).status_code, 409)
        request["room_code"] = room["room_code"]
        self.assertEqual(self.host.post("/api/rooms/join", json=request).status_code, 409)
        player = self.new_client()
        request = command("Jeff", room_code=room["room_code"])
        player.post("/api/rooms/join", json=request)
        request["room_code"] = "AAAAAA" if room["room_code"] != "AAAAAA" else "BBBBBB"
        self.assertEqual(player.post("/api/rooms/join", json=request).status_code, 409)

    def test_legacy_cookie_tab_and_new_join_command_keep_same_seat(self):
        room = self.create()
        player = self.new_client()
        first = self.join(player, room, "Jeff").json()
        tab = self.enterContext(TestClient(self.app))
        tab.cookies.update(player.cookies)
        response = self.join(tab, room, "  Jeff ")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), first)
        self.assertEqual(tab.get(f'/api/rooms/{room["room_id"]}').json(), first)
        renamed = self.join(player, room, "Another")
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["self_member_id"], first["self_member_id"])
        self.assertEqual(renamed.json()["room_version"], first["room_version"] + 1)

    def test_capacity_includes_host_and_existing_member_can_rejoin_full_room(self):
        room = self.create()
        player = self.new_client()
        self.join(player, room, "Player 1")
        for number in range(2, 30):
            self.assertEqual(self.join(self.new_client(), room, f"Player {number}").status_code, 200)
        response = self.join(self.new_client(), room, "Overflow")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "room_full")
        self.assertEqual(len(self.join(player, room, "Player 1").json()["members"]), 30)

    def test_names_and_codes_and_commands_are_validated(self):
        for name in ("   ", "x" * 41, "A\x00B", 123):
            self.assertEqual(self.host.post("/api/rooms", json=command(name)).status_code, 422)
        self.assertEqual(self.host.post("/api/rooms", json={"display_name": "Ricardo"}).status_code, 422)
        self.assertEqual(self.host.post("/api/rooms", json=command("Ricardo", is_host=True)).status_code, 422)
        self.assertEqual(self.host.post("/api/rooms/join", json=command("Jeff", room_code="bad")).status_code, 422)

    def test_room_isolation_even_when_one_session_joins_both(self):
        first = self.create()
        other_host = self.new_client()
        second = other_host.post("/api/rooms", json=command("Ricardo")).json()
        self.assertEqual(other_host.get(f'/api/rooms/{first["room_id"]}').status_code, 403)
        self.assertEqual(self.host.get(f'/api/rooms/{second["room_id"]}').status_code, 403)
        self.assertEqual(self.join(self.host, second, "Guest").status_code, 200)
        self.assertEqual(len(self.host.get(f'/api/rooms/{first["room_id"]}').json()["members"]), 1)
        self.assertEqual(len(other_host.get(f'/api/rooms/{second["room_id"]}').json()["members"]), 2)

    def test_backend_restart_does_not_recover_rooms_or_credentials(self):
        room = self.create()
        with TestClient(create_app()) as restarted:
            restarted.cookies.update(self.host.cookies)
            self.assertEqual(restarted.get(f'/api/rooms/{room["room_id"]}').status_code, 401)
            restarted.get("/api/session")
            self.assertEqual(restarted.get(f'/api/rooms/{room["room_id"]}').status_code, 404)

    def test_cors_and_origin_checks_for_credentialed_frontend(self):
        response = self.host.options("/api/rooms", headers={
            "origin": "http://localhost:5173", "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:5173")
        self.assertEqual(response.headers["access-control-allow-credentials"], "true")
        self.assertEqual(self.host.post("/api/rooms", json=command("Blocked"), headers={"Origin": "https://untrusted.example"}).status_code, 403)
        self.assertEqual(self.host.post("/api/rooms", json=command("Allowed"), headers={"Origin": "http://localhost:5173"}).status_code, 201)
        with self.assertRaises(ValueError):
            create_app(allowed_origins=["*"])


class ConcurrentRoomTests(unittest.IsolatedAsyncioTestCase):
    async def test_simultaneous_create_retries_return_one_room(self):
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as host:
            await host.get("/api/session")
            request = command("Host")
            responses = await asyncio.gather(*(host.post("/api/rooms", json=request) for _ in range(10)))
            self.assertTrue(all(response.status_code == 201 for response in responses))
            self.assertTrue(all(response.json() == responses[0].json() for response in responses))
            self.assertEqual(len(responses[0].json()["members"]), 1)

    async def test_simultaneous_joins_stop_at_thirty(self):
        app = create_app()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as host:
            await host.get("/api/session")
            room = (await host.post("/api/rooms", json=command("Host"))).json()

            async def join(number):
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as player:
                    await player.get("/api/session")
                    return await player.post("/api/rooms/join", json=command(f"Player {number}", room_code=room["room_code"]))

            responses = await asyncio.gather(*(join(i) for i in range(35)))
            self.assertEqual(sum(response.status_code == 200 for response in responses), 29)
            self.assertEqual(sum(response.status_code == 409 for response in responses), 6)
            snapshot = (await host.get(f'/api/rooms/{room["room_id"]}')).json()
            self.assertEqual(len(snapshot["members"]), 30)
            self.assertEqual(snapshot["room_version"], 30)

    async def test_simultaneous_same_browser_commands_only_add_one_member(self):
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as host:
            await host.get("/api/session")
            room = (await host.post("/api/rooms", json=command("Host"))).json()
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as player:
                await player.get("/api/session")
                request = command("Jeff", room_code=room["room_code"])
                responses = await asyncio.gather(*(player.post("/api/rooms/join", json=request) for _ in range(10)))
                self.assertTrue(all(response.status_code == 200 for response in responses))
                self.assertTrue(all(response.json() == responses[0].json() for response in responses))
                self.assertEqual(len(responses[0].json()["members"]), 2)


if __name__ == "__main__":
    unittest.main()
