"""Small localhost JSON API; no third-party runtime dependencies."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
from urllib.parse import urlsplit

from .core import Problem
from .scenario import preparation


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, controller, port=8765):
        self.controller = controller
        self.stopped = threading.Event()
        super().__init__(("127.0.0.1", port), Handler)
        self.ticker = threading.Thread(target=self.tick, daemon=True)
        self.ticker.start()

    def tick(self):
        while not self.stopped.wait(0.25):
            self.controller.tick_all()

    def server_close(self):
        self.stopped.set()
        super().server_close()
        self.ticker.join(timeout=2)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Do not log authorization headers, user text, or URLs.

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        try:
            if self.headers.get("Origin"):
                raise Problem("This headless prototype does not accept browser-origin requests", 403)
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 65536:
                raise Problem("Request exceeds 64 KiB", 413)
            data = json.loads(self.rfile.read(length)) if length else {}
            if not isinstance(data, dict):
                raise Problem("Request must be a JSON object")
            authorization = self.headers.get("Authorization", "")
            token = authorization.removeprefix("Bearer ") if authorization.startswith("Bearer ") else ""
            result = self.route(urlsplit(self.path).path.strip("/").split("/"), token, data)
            self.reply(200, result)
        except Problem as exc:
            self.reply(exc.status, {"error": str(exc)})
        except (ValueError, TypeError, KeyError):
            self.reply(400, {"error": "Malformed request"})
        except Exception:
            self.reply(500, {"error": "Internal request failure"})

    def reply(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def route(self, parts, token, data):
        c = self.server.controller
        if self.command == "GET" and parts == ["health"]:
            return {"ok": True, "mode": "headless", "voice": "opt-in", "model_configured": c.model is not None}
        if self.command == "GET" and parts == ["preparation"]:
            c.organizer(token)
            return preparation()
        if self.command == "POST" and parts == ["sessions"]:
            return c.create(token, data.get("participants"))
        if len(parts) < 3 or parts[0] != "sessions":
            raise Problem("Route not found", 404)
        sid, operation = parts[1:3]
        if self.command == "GET":
            if operation == "state" and len(parts) == 3:
                return c.state(sid, token)
            raise Problem("Route not found", 404)
        if len(parts) == 5 and operation == "decisions":
            return c.decision(sid, token, parts[3], parts[4])
        if len(parts) != 3:
            raise Problem("Route not found", 404)
        if operation == "join":
            return c.join(sid, data.get("invitation"))
        if operation == "contributions":
            return c.contribute(sid, token, data)
        if operation == "proposals":
            return c.propose(sid, token, data)
        if operation == "coordination":
            return c.coordinate(sid, token, data)
        if operation == "talk":
            return c.talk(sid, token, data)
        if operation == "speech":
            return c.speech(sid, token, data.get("operation"), data.get("speech_id"))
        if operation == "debrief":
            return c.debrief(sid, token)
        raise Problem("Route not found", 404)
