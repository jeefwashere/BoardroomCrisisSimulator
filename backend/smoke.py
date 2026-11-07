"""Exercise a running lobby server with independent HTTP cookie jars."""

from contextlib import ExitStack
import json
from uuid import uuid4

import httpx2


def main():
    with ExitStack() as stack:
        clients = [stack.enter_context(httpx2.Client(base_url="http://127.0.0.1:8000", timeout=5)) for _ in range(4)]
        host, player, third, outsider = clients
        for path in ("/api/health", "/docs", "/openapi.json"):
            assert host.get(path).status_code == 200, path
        for client in clients:
            assert client.get("/api/session").status_code == 200
        response = host.post("/api/rooms", json={"command_id": str(uuid4()), "display_name": "Ricardo"})
        assert response.status_code == 201, response.text
        room = response.json()
        joined_request = {"command_id": str(uuid4()), "display_name": "Jeff", "room_code": room["room_code"]}
        joined = player.post("/api/rooms/join", json=joined_request)
        assert joined.status_code == 200, joined.text
        assert third.post("/api/rooms/join", json={
            "command_id": str(uuid4()), "display_name": "Arjun", "room_code": room["room_code"],
        }).status_code == 200
        path = f'/api/rooms/{room["room_id"]}'
        for client in (host, player, third):
            snapshot = client.get(path)
            assert snapshot.status_code == 200
            assert len(snapshot.json()["members"]) == 3
            assert snapshot.json()["room_version"] == 3
        assert player.post("/api/rooms/join", json=joined_request).json() == joined.json()
        assert outsider.get(path).status_code == 403
        print(json.dumps({"status": "passed", "members": 3, "duplicate_join": "same receipt", "outsider": "rejected", "mode": "local lobby only"}))


if __name__ == "__main__":
    main()
