import argparse
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import time
import urllib.request

from .adapters import load_env, RemoteModel
from .core import Controller, Store
from .http import Server
from .scenario import OPENING


def request(base, method, path, token="", data=None):
    req = urllib.request.Request(base + path, method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)


def configured_model():
    url = os.environ.get("LOCAL_MODEL_URL")
    return RemoteModel(url, os.environ.get("LOCAL_MODEL_TOKEN", "")) if url else None


def demo(output, use_local=False):
    with tempfile.TemporaryDirectory() as temp:
        now = [time.time()]
        admin = secrets.token_urlsafe(32)
        controller = Controller(Store(Path(temp) / "demo.sqlite"), admin,
                                model=configured_model() if use_local else None, clock=lambda: now[0])
        if use_local and controller.model is None:
            raise ValueError("Set LOCAL_MODEL_URL and LOCAL_MODEL_TOKEN for --local-model")
        server = Server(controller, port=0)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            started = time.monotonic()
            roster = [{"id": "arjun", "name": "Arjun", "role": "chair"},
                      {"id": "jeff", "name": "Jeff", "role": "member"},
                      {"id": "ricardo", "name": "Ricardo", "role": "member"}]
            created = request(base, "POST", "/sessions", admin, {"participants": roster})
            root = "/sessions/" + created["session_id"]
            tokens = {pid: request(base, "POST", root + "/join", data={"invitation": invitation})["token"] for pid, invitation in created["invitations"].items()}
            contribution = request(base, "POST", root + "/contributions", tokens["jeff"],
                                   {"segment_id": "demo-1", "text": "I propose contacting IT. Jeff can own it and report back in five minutes."})
            request(base, "POST", root + "/contributions", tokens["ricardo"],
                    {"segment_id": "demo-2", "text": "Which systems are unavailable?"})
            proposal = request(base, "POST", root + "/proposals", tokens["jeff"], {
                "request_id": "demo-proposal", "action": "Contact IT to establish outage scope", "action_kind": "contact_it",
                "owner": "jeff", "rationale": "Establish confirmed facts before public updates", "review_time": "In five minutes",
                "evidence": [contribution["event_id"]]})
            confirmed = request(base, "POST", root + "/decisions/" + proposal["id"] + "/confirm", tokens["arjun"], {})
            duplicate = request(base, "POST", root + "/decisions/" + proposal["id"] + "/confirm", tokens["arjun"], {})
            assert confirmed == duplicate
            reply = request(base, "POST", root + "/talk", tokens["ricardo"], {"request_id": "demo-talk", "role": "it_support", "text": "Which systems are unavailable?"})
            now[0] += 601  # Test clock only: the production server always uses wall time.
            state = request(base, "GET", root + "/state", tokens["jeff"])
            report = request(base, "POST", root + "/debrief", tokens["arjun"], {})
            result = {"mode": "local-model" if use_local else "authored-offline", "participants": 3,
                      "elapsed_ms": round((time.monotonic() - started) * 1000, 2), "contribution": contribution,
                      "character_reply": reply, "state": state, "debrief": report}
            Path(output).parent.mkdir(parents=True, exist_ok=True)
            Path(output).write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps({"ok": True, "mode": result["mode"], "participants": 3,
                              "confirmed_decisions": 1, "round": state["round"], "report": str(output),
                              "character_source": reply["source"], "elapsed_ms": result["elapsed_ms"]}, indent=2))
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


def main():
    load_env()
    p = argparse.ArgumentParser(description="Headless rehearsal controller and smoke tests")
    subs = p.add_subparsers(dest="command", required=True)
    d = subs.add_parser("demo", help="Run three participants through the real HTTP API without paid calls")
    d.add_argument("--output", default="artifacts/demo.json")
    d.add_argument("--local-model", action="store_true")
    m = subs.add_parser("model-smoke", help="Exercise the private LFM3 and GLiNER adapters")
    m.add_argument("--output", default="artifacts/model-smoke.json")
    s = subs.add_parser("serve", help="Start a localhost-only session controller")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--db", default=".local/rehearsal.sqlite")
    v = subs.add_parser("voice", help="Explicit, budgeted ElevenLabs speech smoke test")
    v.add_argument("operation", choices=["voices", "opening", "transcribe"])
    v.add_argument("--voice-id")
    v.add_argument("--wav")
    v.add_argument("--max-usd", type=float, default=0)
    v.add_argument("--tts-per-1k", type=float)
    v.add_argument("--stt-per-minute", type=float)
    args = p.parse_args()
    if args.command == "demo":
        demo(args.output, args.local_model)
    elif args.command == "model-smoke":
        model = configured_model()
        if model is None:
            p.error("LOCAL_MODEL_URL and LOCAL_MODEL_TOKEN are required")
        health = request(model.base_url, "GET", "/health", model.token)
        results = []
        for text, expected in [("Maybe Jeff could call IT.", "proposal"),
                               ("Which systems are unavailable?", "question"),
                               ("I am concerned about tomorrow's appointments.", "concern")]:
            start = time.monotonic()
            result = model.extract(text)
            results.append({"text": text, "expected_kind": expected, "result": result,
                            "kind_matches": result.get("kind") == expected,
                            "round_trip_ms": round((time.monotonic() - start) * 1000, 2)})
        scoped = {"role": "it_support", "question": "Which system is unavailable?",
                  "facts": {"outage": "The booking system is unavailable.", "unknown": "The cause is unconfirmed."}}
        start = time.monotonic()
        selection = model.select_facts(scoped)
        output = {"health": health, "extraction_cases": results,
                  "selected_fact_ids": selection, "selection_round_trip_ms": round((time.monotonic() - start) * 1000, 2)}
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(output, indent=2) + "\n")
        print(json.dumps(output, indent=2))
    elif args.command == "serve":
        token = os.environ.get("REHEARSAL_ADMIN_TOKEN")
        if not token:
            p.error("Set REHEARSAL_ADMIN_TOKEN in .env.local before starting the server")
        server = Server(Controller(Store(args.db), token, configured_model()), args.port)
        print(f"Rehearsal API listening on http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    else:
        from .voice import ElevenSpeech, VoiceBudget
        client = ElevenSpeech(os.environ.get("ELEVENLABS_API_KEY"), VoiceBudget(".local/voice-budget.sqlite", args.max_usd),
                              ".local/audio", args.tts_per_1k, args.stt_per_minute)
        if args.operation == "voices":
            # Return identifiers and display names, no account credentials.
            result = [{"voice_id": x["voice_id"], "name": x["name"]} for x in client.voices().get("voices", [])]
        elif args.operation == "opening":
            result = client.speak(OPENING, args.voice_id)
        else:
            if not args.wav:
                p.error("--wav is required for transcribe")
            result = client.transcribe_wav(args.wav)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
