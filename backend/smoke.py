"""Exercise a running backend through independent browser cookie jars."""

from contextlib import ExitStack
import json
from uuid import uuid4

import httpx2


def main():
    with ExitStack() as stack:
        clients = [stack.enter_context(httpx2.Client(base_url="http://127.0.0.1:8000", timeout=5)) for _ in range(4)]
        host, player, third, newcomer = clients
        for path in ("/api/health", "/docs", "/openapi.json", "/api/scenarios"):
            assert host.get(path).status_code == 200, path
        for client in clients:
            assert client.get("/api/session").status_code == 200
        response = host.post("/api/rooms", json={
            "command_id": str(uuid4()), "room_code": uuid4().hex[:6].upper(), "display_name": "Ricardo",
        })
        assert response.status_code == 201, response.text
        room = response.json()
        joined_request = {"command_id": str(uuid4()), "display_name": "Jeff", "room_code": room["room_code"]}
        joined = player.post("/api/rooms/join", json=joined_request)
        assert joined.status_code == 200, joined.text
        response = third.post("/api/rooms/join", json={
            "command_id": str(uuid4()), "display_name": "Arjun", "room_code": room["room_code"],
        })
        assert response.status_code == 200, response.text
        path = f'/api/rooms/{room["room_id"]}'
        assert newcomer.get(path).status_code == 403
        current = host.get(path).json()
        roles = ("security", "ceo", "finance")
        body = {
            "command_id": str(uuid4()), "room_code": room["room_code"],
            "scenario_id": "maplecart_cybersecurity", "scenario_version": 2,
            "timing_profile": "standard_18",
            "players": [{"member_id": member["member_id"], "role_id": role}
                        for member, role in zip(current["members"], roles)],
        }
        assert player.post(f"{path}/start", json=body).status_code == 403
        started = host.post(f"{path}/start", json=body)
        assert started.status_code == 200, started.text
        assert started.json()["phase"] == "briefing"
        assert len(started.json()["game"]["eligible_member_ids"]) == 3
        assert host.post(f"{path}/start", json=body).json() == started.json()
        late = newcomer.post("/api/rooms/join", json={
            "command_id": str(uuid4()), "display_name": "Sam", "room_code": room["room_code"], "role_id": "finance",
        })
        assert late.status_code == 200, late.text
        self_member = next(member for member in late.json()["members"] if member["member_id"] == late.json()["self_member_id"])
        assert self_member["eligible_from_round"] == 2
        assert not self_member["eligible_current_round"]
        for client in clients:
            snapshot = client.get(path)
            assert snapshot.status_code == 200
            assert len(snapshot.json()["members"]) == 4
            assert len(snapshot.json()["game"]["eligible_member_ids"]) == 3
        assert player.post("/api/rooms/join", json=joined_request).json() == joined.json()
        print(json.dumps({"status": "passed", "members": 4, "initial_electorate": 3,
                          "phase": "briefing", "late_member_first_round": 2,
                          "ceo_cannot_start": True, "mode": "initial briefing only"}))


if __name__ == "__main__":
    main()
