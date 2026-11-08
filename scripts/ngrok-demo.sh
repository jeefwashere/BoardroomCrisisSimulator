#!/usr/bin/env bash
# Public three window demo over one ngrok address (see docs/ngrok-demo.md).
#
# Starts a Vite dev server with my-app/vite.tunnel.config.ts (the app plus an /api proxy to the backend) and an
# ngrok tunnel to it, then prints the public address. The backend must already be running (default
# http://127.0.0.1:8000). Stop everything with Ctrl+C.
#
# The tunnel asks for a login by default, because the backend can spend paid Vertex AI and ElevenLabs credit.
#   NGROK_BASIC_AUTH=user:password   use this login instead of the generated one
#   NGROK_BASIC_AUTH=off             no login (anyone with the address can play and trigger paid calls)
#   TUNNEL_PORT=5175                 local port for the tunnel's Vite server
#   BOARDROOM_BACKEND=http://127.0.0.1:8000
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${TUNNEL_PORT:-5175}"
BACKEND="${BOARDROOM_BACKEND:-http://127.0.0.1:8000}"
STATE="$ROOT/my-app/.local/ngrok-demo"   # ignored by git
mkdir -p "$STATE"

command -v ngrok >/dev/null || { echo "ngrok is not installed. See https://ngrok.com/download" >&2; exit 1; }
curl -fsS "$BACKEND/api/health" >/dev/null || { echo "The backend is not reachable at $BACKEND. Start it first (see docs/ngrok-demo.md)." >&2; exit 1; }
if curl -fsS http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; then
  echo "Another ngrok agent is already running (its inspector answers on port 4040). Stop it first." >&2; exit 1
fi

AUTH="${NGROK_BASIC_AUTH:-}"
if [ -z "$AUTH" ]; then
  if [ ! -s "$STATE/login" ]; then
    printf 'boardroom:%s\n' "$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))')" > "$STATE/login"
    chmod 600 "$STATE/login"
  fi
  AUTH="$(cat "$STATE/login")"
fi
AUTH_ARGS=()
[ "$AUTH" != "off" ] && AUTH_ARGS=(--basic-auth "$AUTH")

VITE_PID=""
NGROK_PID=""
cleanup() { [ -n "$NGROK_PID" ] && kill "$NGROK_PID" 2>/dev/null; [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null; true; }
trap cleanup EXIT INT TERM

cd "$ROOT/my-app"
# An empty API address makes the app call /api on its own origin (the tunnel), which this Vite server proxies.
TUNNEL_PORT="$PORT" BOARDROOM_BACKEND="$BACKEND" VITE_API_BASE_URL= npx vite --config vite.tunnel.config.ts > "$STATE/vite.log" 2>&1 &
VITE_PID=$!
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "The tunnel's Vite server did not start; see $STATE/vite.log" >&2; exit 1; }

ngrok http "$PORT" ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} --log "$STATE/ngrok.log" --log-format logfmt > /dev/null &
NGROK_PID=$!
URL=""
for _ in $(seq 1 60); do
  URL="$(curl -fsS http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c 'import json, sys
tunnels = json.load(sys.stdin).get("tunnels", [])
print(next((t["public_url"] for t in tunnels if t["public_url"].startswith("https://")), ""))' 2>/dev/null || true)"
  [ -n "$URL" ] && break
  sleep 0.5
done
[ -n "$URL" ] || { echo "ngrok did not report a public address; see $STATE/ngrok.log" >&2; exit 1; }
printf '%s\n' "$URL" > "$STATE/url"

echo
echo "Public game:      $URL/"
echo "Three window demo: $URL/#/demo   (choose \"Three independent windows\")"
if [ "$AUTH" = "off" ]; then
  echo "Login:            none (NGROK_BASIC_AUTH=off)"
else
  echo "Login:            ${AUTH%%:*} / ${AUTH#*:}   (share with the other players; saved in $STATE/login)"
fi
echo "Logs:             $STATE"
echo "Press Ctrl+C to stop the tunnel."
wait "$NGROK_PID"
