"""Real localhost HTTP fixture with trusted internal narrative events, no providers."""

import argparse
import asyncio
from contextlib import AsyncExitStack
import json
from pathlib import Path
import socket
from uuid import UUID, uuid4

import httpx2
import uvicorn

from .app.main import create_app
from .app.narration import NarrationService
from .app.rooms import Rooms
from .app.scenarios import ScenarioCatalog
from .app import simulation as sim


class FixtureClock:
    value = 0.0

    def __call__(self):
        return self.value


def command(**fields):
    return {"command_id": str(uuid4()), **fields}


async def run(output: Path, fake_audio: bool):
    clock = FixtureClock()
    rooms = Rooms(ScenarioCatalog(), clock, automatic=False)
    generated = []

    def fake_synthesize(text):
        generated.append(text)
        return b"ID3-TEST-FIXTURE-NOT-SPOKEN-AUDIO"

    speech = NarrationService(fake_synthesize if fake_audio else None)
    app = create_app(rooms=rooms, narration_service=speech)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False, lifespan="off"))
    server_task = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        for _ in range(100):
            if server.started:
                break
            if server_task.done():
                await server_task
                raise RuntimeError("Owned fixture server did not start")
            await asyncio.sleep(0.01)
        else:
            raise RuntimeError("Owned fixture server startup timed out")
        async with AsyncExitStack() as stack:
            clients = [await stack.enter_async_context(httpx2.AsyncClient(
                base_url=f"http://127.0.0.1:{port}", timeout=5,
            )) for _ in range(4)]
            for client in clients:
                assert (await client.get("/api/session")).status_code == 200
            host = clients[0]
            response = await host.post("/api/rooms", json=command(room_code="DEMO30", display_name="Host"))
            assert response.status_code == 201, response.text
            view = response.json()
            path, room_id = f'/api/rooms/{view["room_id"]}', UUID(view["room_id"])
            for number, client in enumerate(clients[1:3], 1):
                assert (await client.post("/api/rooms/join", json=command(
                    room_code="DEMO30", display_name=f"Player {number}",
                ))).status_code == 200
            view = (await host.get(path)).json()
            start = command(room_code="DEMO30", scenario_id="maplecart_cybersecurity", scenario_version=3,
                            timing_profile="standard_18", players=[
                                {"member_id": member["member_id"], "role_id": "ceo" if index == 0 else "security"}
                                for index, member in enumerate(view["members"])
                            ])
            response = await host.post(path + "/start", json=start)
            assert response.status_code == 200, response.text
            clock.value = 90
            state = await rooms.transition_internal(room_id, uuid4(), UUID(response.json()["game"]["phase_id"]), sim.BeginDecision())
            choices = ("contain_targeted", "communicate_facts", "recover_staged")
            for number, choice in enumerate(choices, 1):
                for index, client in enumerate(clients[:3]):
                    response = await client.post(path + "/contributions", json=command(
                        phase_id=str(state.phase.phase_id), kind="answer" if index < 2 else "chat",
                        source="speech" if index == 2 else "typed",
                        text=f"Round {number} fixture contribution {index}; retain this even if not selected.",
                    ))
                    assert response.status_code == 201, response.text
                event_id = uuid4()
                old_phase = state.phase.phase_id
                state = await rooms.transition_internal(room_id, event_id, old_phase, sim.ResolvePrepared(choice))
                assert await rooms.transition_internal(room_id, event_id, old_phase, sim.ResolvePrepared(choice)) == state
                snapshot = (await host.get(path)).json()
                assert snapshot["game"]["last_result"]["text"] == state.history[-1].text
                assert "initial_metrics" not in snapshot["game"]
                nid = snapshot["game"]["narration"]["narration_id"]
                media_path = f"{path}/narration/{nid}"
                prepared = await host.post(media_path + "/prepare")
                assert prepared.status_code == 200, prepared.text
                assert prepared.json()["status"] == ("ready" if fake_audio else "disabled")
                if fake_audio:
                    assert (await clients[1].post(media_path + "/prepare")).json() == prepared.json()
                    assert (await clients[1].get(media_path + "/audio")).content == b"ID3-TEST-FIXTURE-NOT-SPOKEN-AUDIO"
                if number == 1:
                    late = await clients[3].post("/api/rooms/join", json=command(
                        room_code="DEMO30", display_name="Late observer", role_id="finance",
                    ))
                    assert late.status_code == 200
                    assert len(late.json()["game"]["eligible_member_ids"]) == 3
                    assert (await clients[3].post(path + "/contributions", json=command(
                        phase_id=str(state.phase.phase_id), kind="chat", source="typed", text="Late observer chat is still evidence.",
                    ))).status_code == 201
                if number < 3:
                    clock.value += 30
                    assert (await host.get(media_path + "/audio")).status_code == 410
                    state = await rooms.transition_internal(room_id, uuid4(), state.phase.phase_id, sim.AdvanceResult())
                    assert len((await host.get(path)).json()["game"]["eligible_member_ids"]) == 4
            response = await host.get(path + "/evaluation-evidence")
            assert response.status_code == 200, response.text
            evidence = response.json()
            assert len(evidence["contributions"]) == 10 and len(evidence["decisions"]) == 3
            assert state.phase.kind == "ended"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")
            print(json.dumps({"status": "passed", "mode": "trusted internal fixture over real localhost HTTP",
                              "decisions": 3, "contributions": 10, "members": 4,
                              "ending": evidence["ending_label"], "fixed_gameplay_meters": False,
                              "audio": "fake bytes only" if fake_audio else "disabled", "fake_generations": len(generated),
                              "paid_calls": 0, "evidence": str(output)}))
    finally:
        server.should_exit = True
        await asyncio.wait_for(server_task, 5)
        sock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("artifacts/narrative-demo.json"))
    parser.add_argument("--fake-audio", action="store_true", help="Test media bytes and sharing; never generates spoken audio")
    args = parser.parse_args()
    asyncio.run(run(args.output, args.fake_audio))


if __name__ == "__main__":
    main()
