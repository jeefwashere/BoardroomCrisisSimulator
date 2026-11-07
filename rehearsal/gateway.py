"""Private cluster inference gateway. One conversational model, CPU extraction."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import threading
import time

from .adapters import GlinerExtractor, TransformersSelector


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--models", required=True)
    p.add_argument("--token-file", required=True)
    p.add_argument("--port", type=int, default=8877)
    args = p.parse_args()
    if os.environ.get("SLURM_JOB_ID") != "20031":
        raise SystemExit("Gateway must run inside assigned allocation 20031")
    import torch
    if str(torch.cuda.get_device_properties(0).uuid) != "778d17bf-71bd-2cb7-51f6-d39f0ca2fee5":
        raise SystemExit("GPU UUID mismatch")
    token = Path(args.token_file).read_text().strip()
    if len(token) < 32:
        raise SystemExit("Gateway token must contain at least 32 characters")
    started = time.monotonic()
    selector = TransformersSelector(str(Path(args.models) / "LiquidAI/LFM3-1.7B"))
    extractor = GlinerExtractor(str(Path(args.models) / "fastino/gliner2.5-base-v1"))
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def respond(self, status, data):
            encoded = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def authorized(self):
            return secrets.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)

        def do_GET(self):
            if not self.authorized():
                return self.respond(401, {"error": "Unauthorized"})
            self.respond(200, {"ready": True, "models": ["LFM3-1.7B", "GLiNER2.5-base"],
                               "gpu_allocated_bytes": torch.cuda.memory_allocated(), "uptime_seconds": time.monotonic() - started})

        def do_POST(self):
            if not self.authorized():
                return self.respond(401, {"error": "Unauthorized"})
            begin = time.monotonic()
            acquired = False
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 32768:
                    return self.respond(413, {"error": "Invalid request size"})
                data = json.loads(self.rfile.read(length))
                acquired = lock.acquire(blocking=False)
                if not acquired:
                    return self.respond(503, {"error": "Model busy; use authored fallback"})
                if self.path == "/select":
                    out = {"fact_ids": selector.select_facts(data)}
                elif self.path == "/generate" and isinstance(data.get("text"), str) and 0 < len(data["text"]) <= 4000:
                    out = {"text": selector.generate_text(data["text"]), "model": "LiquidAI/LFM3-1.7B"}
                elif self.path == "/extract" and isinstance(data.get("text"), str) and 0 < len(data["text"]) <= 5000:
                    out = extractor.extract(data["text"])
                else:
                    return self.respond(400, {"error": "Unknown operation or invalid text"})
                out["latency_ms"] = round((time.monotonic() - begin) * 1000, 2)
                self.respond(200, out)
            except Exception as exc:
                print("REQUEST_FAILED", type(exc).__name__, flush=True)
                self.respond(503, {"error": "Local inference unavailable; use authored fallback"})
            finally:
                if acquired:
                    lock.release()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    print(json.dumps({"ready": True, "host": "127.0.0.1", "port": args.port,
                      "load_seconds": round(time.monotonic() - started, 2),
                      "gpu_allocated_bytes": torch.cuda.memory_allocated()}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
