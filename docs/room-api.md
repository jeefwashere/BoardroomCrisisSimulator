# First FastAPI room capability

Status: implemented lobby scope. This delivery supports creating a room, joining by code, and reading its member snapshot. Jeff owns the frontend pages before game start. This change supplies their backend contract and does not edit those pages.

## Confirmed decisions

Updated product direction: Jeff generates the room code and owns lobby role selection. The host submits the room code, members, and selected roles together when clicking Start. At least 3 participants are required to start, capacity is 30, and new participants may join after start. The current published lobby API does not yet implement the Start handoff or gameplay admission. Identity handoff and late join participation timing remain under clarification.

1. The creator is the host and occupies one of the 30 seats.
2. Names are trimmed, then compared using Unicode case folding within each room. The trimmed spelling is displayed. Names contain 1 to 40 printable characters. The same name may exist in different rooms.
3. Only the host and joined members can read full room and member details. Room codes locate rooms; display names do not authenticate members.
4. Active rooms and membership credentials live in memory in one backend process. Refresh retains the seat through the browser cookie while this process lives. Restart, development reload, clearing cookies, or changing browser profiles loses access to the old membership. Restart also loses all rooms.
5. Lobby updates may use approximately two second frontend polling before WebSocket delivery is added.

## Local setup

Use Python 3.11 or newer. Run from the repository root. Dependencies are isolated from the existing model environment and pinned in `backend/requirements.txt`.

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Health: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health).
Interactive API documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).
Machine contract: [http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json).

Run exactly one worker. Separate workers have separate rooms and credentials. This development service has no room expiration, public traffic limits, or durable storage. Choose deployment retention and admission limits before public hosting. The health response establishes HTTP availability, not model availability or game readiness.

## Browser identity

Before submitting either form, call `GET /api/session` with credentials enabled. Wait for it to succeed before submitting concurrent actions. It sets an opaque `boardroom_session` cookie with `HttpOnly`, `SameSite=Lax`, and path `/api`. Repeated initialization retains a valid cookie. It returns only `{"status":"ready"}` and does not expose the secret to JavaScript.

This small initialization request gives every subsequent command a stable identity, including a retry whose original create response was lost. It does not create a room or occupy a seat. A missing or unknown cookie yields `401` on room endpoints. After backend restart, initialize again and create or join a new room.

One browser profile has one seat per room. Tabs sharing the cookie share that seat. Use separate browser profiles or independently managed cookie jars for distinct human players. A browser may have seats in multiple rooms. Store the selected `room_id` in the frontend route so refresh can query the same room. Do not try to reclaim a seat by matching its name.

## Implemented endpoints

1. `GET /api/health`: public `{"status":"ok","storage":"memory"}`.
2. `GET /api/session`: initialize or retain private browser identity.
3. `POST /api/rooms`: authenticated create, returns `201` with the room snapshot and host seat.
4. `POST /api/rooms/join`: authenticated join, returns `200` with the caller's snapshot.
5. `GET /api/rooms/{room_id}`: authenticated member snapshot, returns `200`.

Create body:

```json
{
  "command_id": "79fc9905-0060-4ac4-8636-0ffdd3308437",
  "display_name": "Ricardo"
}
```

Join body:

```json
{
  "command_id": "141afabb-6d7d-446c-b68c-eb7e42301c76",
  "room_code": "K7MPQ2",
  "display_name": "Jeff"
}
```

Codes contain six characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Input codes accept lowercase and surrounding whitespace. The example code is illustrative; use the actual create response.

Every successful room response has this shape:

```json
{
  "room_id": "5348d418-5e34-47c9-84af-a9097abb348e",
  "room_code": "K7MPQ2",
  "room_version": 2,
  "phase": "lobby",
  "capacity": 30,
  "host_member_id": "9d716cd1-a7c8-4e73-a8ac-a05634972559",
  "self_member_id": "4d9f5d4a-a9b9-412a-9bf4-dd673cabef79",
  "members": [
    {
      "member_id": "9d716cd1-a7c8-4e73-a8ac-a05634972559",
      "display_name": "Ricardo",
      "is_host": true
    },
    {
      "member_id": "4d9f5d4a-a9b9-412a-9bf4-dd673cabef79",
      "display_name": "Jeff",
      "is_host": false
    }
  ]
}
```

Member IDs and host flags are server assigned. Clients cannot submit them. The snapshot contains all joined seats, not live connection presence. It does not claim a connected count or start eligibility. Host authority does not imply CEO authority. Roles are not assigned in this capability.

## Retries and polling

Generate a UUID `command_id` once for each user intent. Retain that ID and body for transport retries. A different intent needs a new ID. IDs are scoped to the browser session across create and join commands. An exact successful retry returns the original snapshot without another room or seat. Reusing an ID with a different normalized body returns `409 command_conflict`. Failed attempts are not saved as successful receipts.

Rejoining the same room with the same browser and equivalent name returns the existing seat even with a new command ID or when the room is full. Entering a different name from that browser returns `409 already_joined`; rename and switching seats are not implemented. Clearing the cookie does not release its old seat. Room capacity counts joined seats, including disconnected browsers, until a later lifecycle capability provides removal.

After create or join, poll `GET /api/rooms/{room_id}` about every two seconds. Permit one outstanding poll at a time and stop polling when leaving the page. For the same room, discard a response with a lower `room_version` than the latest rendered snapshot. Exact command retries intentionally return their original version, which may now be older. A new join increments the version once; reads and duplicate joins do not.

## Frontend example for Jeff

This is an integration example, not a change to the frontend source. Use the same hostname for frontend and backend during local development, such as `localhost` for both. A Vite origin at port 5173 is allowed by default.

```js
const API = "http://localhost:8000";

async function request(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    ...(body ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw payload;
  return payload;
}

// Initialize once and await this before allowing form submissions.
await request("/api/session");

// Host form. Keep this body unchanged when retrying a failed connection.
const createBody = {
  command_id: crypto.randomUUID(),
  display_name: "Ricardo",
};
const room = await request("/api/rooms", createBody);

// A different player's browser uses its own initialized session.
const joinBody = {
  command_id: crypto.randomUUID(),
  room_code: room.room_code,
  display_name: "Jeff",
};
// Run in the other browser:
// const joined = await request("/api/rooms/join", joinBody);

// Run each polling cycle after the preceding request finishes.
const current = await request(`/api/rooms/${room.room_id}`);
```

A same origin frontend can use `const API = ""` behind a reverse proxy. Set `BOARDROOM_SECURE_COOKIE=true` when serving HTTPS. `BOARDROOM_ALLOWED_ORIGINS` accepts a comma separated list of exact frontend origins, for example `https://boardroom.example`. Wildcard origins are rejected. Browser POST requests from other origins are rejected. CORS credential requirements follow the [official Starlette middleware documentation](https://starlette.dev/middleware/#corsmiddleware).

## Error contract

Domain errors use this envelope:

```json
{
  "detail": {
    "code": "name_taken",
    "message": "Choose another display name"
  }
}
```

1. `401 session_required`: missing, forged, or obsolete browser session.
2. `403 not_a_member`: valid session without membership in the requested room.
3. `403 origin_not_allowed`: browser POST origin is not allowed.
4. `404 room_not_found`: unknown code or room ID.
5. `409 name_taken`: another seat has the normalized display name.
6. `409 room_full`: a new seat would exceed 30.
7. `409 already_joined`: this browser already owns a differently named seat in that room.
8. `409 command_conflict`: a successful command ID was reused for a different intent.
9. `422`: FastAPI validation errors use its normal `detail` array, including missing UUIDs, malformed codes, invalid names, and unexpected fields.

## Verification

In another terminal while the server above is running:

```sh
backend/.venv/bin/python -m backend.smoke
```

This creates one room using three separate HTTP clients, joins two players, checks the shared snapshot, replays a join, and rejects an unrelated session. It also requests health, `/docs`, and `/openapi.json`. Its result describes the local lobby only.

Automated checks:

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -v
python3 -m unittest discover -s tests -v
python3 -m rehearsal demo --output artifacts/room-module-prototype-demo.json
```

The lobby tests cover authorization, host capacity, normalized names, duplicate commands, extra tabs, room isolation, restart loss, CORS, concurrent capacity, and concurrent retries. They use FastAPI's test client as described in [the official testing guide](https://fastapi.tiangolo.com/tutorial/testing/), with `httpx2` as required by the installed Starlette version. The existing prototype tests and offline demo are separate regression evidence.

## Remaining work

B01 is eligible for completion after startup and publication verification. B02 remains partial because roles, connected presence, minimum start count, and start are not implemented. I01 remains partial because the complete game contract is not implemented. Polling, refresh, and these local clients do not complete B05, B13, I02, I03, or deployment I04. Scenario selection, speaking, voting, CEO ties, AI, and WebSocket delivery follow in separate capabilities.
