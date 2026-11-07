# FastAPI room registration and snapshots

Status: room registration, snapshots, batch Start, and initial briefing are implemented. See [start-api.md](start-api.md) for the new Start operation and late admission contract. Jeff owns the frontend pages before game start. This change supplies their backend contract and does not edit those pages.

## Confirmed decisions

Updated product direction: Jeff generates the room code and owns lobby role selection. The host submits the room code, members, and selected roles together when clicking Start. At least 3 participants are required to start, capacity is 30, and new participants may join after start. Lobby clients register their individual identities before Start. The Start handoff and late admission are now implemented; new arrivals first participate in the round after the current one. Arrival during briefing therefore begins eligibility in round 2. Internal narrative phase transitions are now implemented. Live speaking, voting, and automatic scheduling remain later work; see [narrative-engine.md](narrative-engine.md).

1. The creator is the host and occupies one of the 30 seats.
2. Names are trimmed, then compared using Unicode case folding within each room. The trimmed spelling is displayed. Names contain 1 to 40 printable characters. The same name may exist in different rooms.
3. Only the host and joined members can read full room and member details. Room codes locate rooms; display names do not authenticate members.
4. Active rooms and membership credentials live in memory in one backend process. Each application tab retains its own server issued guest credential across refresh. Legacy clients may still use the browser cookie. Restart or development reload loses rooms and credentials; losing the tab credential loses access to that tab's seats.
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

Before submitting either form, initialize the application tab with `POST /api/tab-sessions`, using JSON `{}` for a new participant or `{"session_token":"<saved credential>"}` to resume. A known credential is retained; an absent or unknown credential creates a fresh opaque server issued credential. The response is `{"status":"ready","session_token":"<private credential>"}` and never sets a cookie. Await initialization before room commands. Store the credential only for the current tab, retain it across refresh, and send it as `X-Boardroom-Session` on every authenticated request. A new tab must initialize a separate identity, including when browser duplication initially copies session storage.

An explicitly supplied header is authoritative. An invalid or empty header receives `401 session_required` even when the request also carries a valid browser cookie. Public member IDs, names, and room codes never serve as credentials. Keep credentials out of URLs, logs, rendered text, and shared room snapshots. This is private guest identity, without an account or provider login.

Legacy clients can still call `GET /api/session` with credentials enabled. It sets the existing opaque `boardroom_session` cookie with `HttpOnly`, `SameSite=Lax`, and path `/api`, retains a valid cookie, and returns only `{"status":"ready"}`. A request without the tab header falls back to this cookie. Cookie clients sharing a browser profile therefore still share a seat. Both initialization methods create an identity without occupying a seat.

Distinct tab credentials create independent players, each counting toward the capacity of 30 and the minimum of 3 to start. Reusing a credential resumes its original seats. Store the selected `room_id` for the current tab so refresh can query the same room. After backend restart, initialize again and create or join a new room; a name cannot recover an old seat.

## Implemented endpoints

1. `GET /api/health`: public `{"status":"ok","storage":"memory"}`.
2. `GET /api/session`: initialize or retain private browser identity.
3. `POST /api/rooms`: authenticated create, returns `201` with the room snapshot and host seat.
4. `POST /api/rooms/join`: authenticated join, returns `200` with the caller's snapshot.
5. `GET /api/rooms/{room_id}`: authenticated member snapshot, returns `200`.
6. `GET /api/scenarios`: public admitted scenario references, roles, and timing profiles.
7. `POST /api/rooms/{room_id}/start`: authenticated host submits the complete roster and selected roles. See [start-api.md](start-api.md).
8. `POST /api/tab-sessions`: initialize or resume a private tab guest identity without setting a cookie.

Contribution ingestion, final evidence export, and consequence narration endpoints are also implemented. Their request bodies and phase rules are documented in [narrative-engine.md](narrative-engine.md).

Create body:

```json
{
  "command_id": "79fc9905-0060-4ac4-8636-0ffdd3308437",
  "room_code": "K7MPQ2",
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

Jeff generates codes before calling create. Codes contain six ASCII letters or digits, normalized to uppercase after trimming. Create requires the supplied code, and a collision returns `409 room_code_taken` so the frontend can generate another. The backend does not generate a replacement. The example code is illustrative; use the actual create response.

A successful lobby response has this shape. Started responses retain the same room fields and expose the current game projection described in [start-api.md](start-api.md) and [narrative-engine.md](narrative-engine.md):

```json
{
  "room_id": "5348d418-5e34-47c9-84af-a9097abb348e",
  "room_code": "K7MPQ2",
  "room_version": 2,
  "phase": "lobby",
  "capacity": 30,
  "presence_window_seconds": 30,
  "game": null,
  "host_member_id": "9d716cd1-a7c8-4e73-a8ac-a05634972559",
  "self_member_id": "4d9f5d4a-a9b9-412a-9bf4-dd673cabef79",
  "members": [
    {
      "member_id": "9d716cd1-a7c8-4e73-a8ac-a05634972559",
      "display_name": "Ricardo",
      "is_host": true,
      "connected": true,
      "role_id": null,
      "eligible_from_round": null,
      "eligible_current_round": false
    },
    {
      "member_id": "4d9f5d4a-a9b9-412a-9bf4-dd673cabef79",
      "display_name": "Jeff",
      "is_host": false,
      "connected": true,
      "role_id": null,
      "eligible_from_round": null,
      "eligible_current_round": false
    }
  ]
}
```

Member IDs and host flags are server assigned. Clients cannot submit them. The snapshot contains all joined seats and server observed activity. A member is connected while its last authenticated room activity is less than 30 seconds old. This is polling presence; it does not instantly detect closed tabs. Host authority does not imply CEO authority. Roles remain null in the lobby and are assigned atomically on Start. See [start-api.md](start-api.md).

## Retries and polling

Generate a UUID `command_id` once for each user intent. Retain that ID and body for transport retries. A different intent needs a new ID. IDs are scoped to the authenticated session across create and join commands. An exact successful retry returns the original snapshot without another room or seat. Reusing an ID with a different normalized body returns `409 command_conflict`. Failed attempts are not saved as successful receipts.

Rejoining the same room with the same credential returns the existing seat even with a new command ID or when the room is full. Submit a new `display_name` through this same join endpoint to rename that seat. Names keep the existing trim, printable length, and Unicode case folding uniqueness rules. A successful spelling change increments `room_version` once while preserving the member ID, join time, host and CEO authority, role, round eligibility, electorate, contributions, and history. An unchanged name does not increment the version. Exact retries retain the original receipt and never reapply an earlier name over a later rename.

Rename is allowed in the lobby and active phases. After ending, names are frozen and a change returns `409 game_ended`; an unchanged name can still rejoin. Existing seats omit `role_id`, or retain their assigned role after Start; a different role is rejected before any name or presence change. A new member joining after Start must supply an allowed non CEO `role_id`. Losing a credential does not release its old seat. Room capacity counts all registered seats until a later lifecycle capability provides removal.

After create or join, poll `GET /api/rooms/{room_id}` about every two seconds. Permit one outstanding poll at a time and stop polling when leaving the page. For the same room, discard a response with a lower `room_version` than the latest rendered snapshot. Exact command retries intentionally return their original version, which may now be older. A new join, rename, or successful Start increments the version once; reads and duplicate commands do not. Activity may change at the same version, so apply current GET responses even if the version is equal. Successful retries refresh their caller's activity but return the unchanged historical receipt.

## Legacy cookie integration example

This example retains the supported cookie flow. The application uses the independent tab credential flow described above. Use the same hostname for frontend and backend during local development, such as `localhost` for both. A Vite origin at port 5173 is allowed by default.

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
const generatedRoomCode = "K7MPQ2"; // Example; use the code generated by the lobby.
const createBody = {
  room_code: generatedRoomCode,
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
7. `409 game_ended`: an ended game cannot admit a new seat or change an existing name.
8. `409 command_conflict`: a successful command ID was reused for a different intent.
9. `409 room_code_taken`: choose another frontend generated code. Start and late join errors are listed in [start-api.md](start-api.md).
10. `422`: FastAPI validation errors use its normal `detail` array, including missing UUIDs, malformed codes, invalid names, and unexpected fields.

## Verification

In another terminal while the server above is running:

```sh
backend/.venv/bin/python -m backend.smoke
```

This registers three distinct clients, rejects an unrelated session and a CEO attempting to start, starts through the host, replays Start, and admits a fourth client with round 2 eligibility. It also requests health, `/docs`, `/openapi.json`, and the scenario catalog. The original first round electorate stays at three. Its result describes initial briefing only.

Automated checks:

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -v
python3 -m unittest discover -s tests -v
python3 -m rehearsal demo --output artifacts/room-module-prototype-demo.json
```

The lobby tests cover authorization, host capacity, normalized names, duplicate commands, extra tabs, room isolation, restart loss, CORS, concurrent capacity, and concurrent retries. They use FastAPI's test client as described in [the official testing guide](https://fastapi.tiangolo.com/tutorial/testing/), with `httpx2` as required by the installed Starlette version. The existing prototype tests and offline demo are separate regression evidence.

## Remaining work

B02 acceptance now covers code based registration, capacity 30, polling presence, host controlled Start, and distinct CEO authority. Completion still requires verified publication under [TODO.md](../TODO.md). Version 3 narrative consequence execution is implemented through trusted internal events. I01 remains partial because the complete live game contract is not implemented. Polling, refresh, and these local clients do not complete B05, B13, I02, I03, or deployment I04. Speaking, voting, CEO ties, AI, WebSocket delivery, and automatic phase advancement follow separately.
