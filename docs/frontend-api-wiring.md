# Frontend room API wiring

This integration uses the implemented FastAPI room contract in [room-api.md](room-api.md) and [start-api.md](start-api.md). The broader API catalog in [backend-architecture.md](backend-architecture.md) includes proposed endpoints and is not the request layer's source of truth.

## Request layer

`my-app/src/services/rooms.ts` exports `createRoomApi`, the `RoomApi` interface, request and public response types, and `RoomApiError`. The default API address is `http://127.0.0.1:8000`. Set `VITE_API_BASE_URL` before starting Vite to choose another address. An empty address selects the current origin when deployment supplies an API reverse proxy. Tests can inject both the base address and fetch implementation.

1. Await `initializeSession` before permitting create or join submission. It initializes or resumes a server issued private tab session through `POST /api/tab-sessions`.
2. Read `scenarios` to get admitted scenario versions, role IDs and timing profiles. Use those exact IDs when submitting Start.
3. Create the host seat with the frontend generated six character room code and the chosen name. Join each other player tab separately.
4. Poll `snapshot` after the previous request finishes. Presence can change at an equal `room_version`, so accept equal version snapshots. Reject lower versions to keep historical command receipts from replacing newer room membership.
5. The host submits all registered member IDs and final role choices together on Start. A successful response enters `briefing`; continue polling the same room.

Room requests send `credentials: 'include'` and the private `X-Boardroom-Session` header. The interactive client keeps its server issued guest credential in session storage for that tab and in memory, never in URLs or local storage. Separate tabs initialize separate credentials; refresh resumes the same credential. The tab ownership helper detects a copied active tab identity before reuse so an opened copy becomes another player. Legacy cookie only API clients remain supported through `GET /api/session`. A supplied invalid tab header is rejected rather than falling back to a cookie.

Use the same hostname for frontend and backend, such as `127.0.0.1` for both. The default CORS allowlist includes port 5173 on `localhost` and `127.0.0.1`, with the explicit tab session header allowed. Another frontend origin requires an explicit `BOARDROOM_ALLOWED_ORIGINS` value. Keep exact origins rather than a wildcard. Fetch credential and cancellation behavior follows the [MDN Fetch documentation](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch).

Each mutation receives a caller supplied `command_id` and serializes the supplied body unchanged. The service never generates IDs or retries POST requests. Preserve the complete body and command ID when retrying an uncertain network result. A changed accepted intent requires a new command ID. Refresh the room before correcting a rejected stale roster.

Each method accepts an optional `AbortSignal`. Cancellation preserves the original cancellation error. HTTP failures expose their status, domain code and message through `RoomApiError`. FastAPI validation failures retain field locations, messages and types in `details`, while omitting submitted inputs and context. Unreachable services, malformed JSON and incompatible successful response shapes produce explicit error codes. Public response guards check the projection used by the lobby and briefing; unused narrative fields remain outside this frontend type.

## Current product boundaries

The incoming Jeff frontend includes a name prompt and edit control, host roster, role controls, upload acknowledgement, and 2D player layout. Its original Join page is empty, the host roster can include opt in synthetic preview players, and Start opens a local preview. Those presentation capabilities alone do not create authenticated membership. The real room integration must use backend snapshots and disable synthetic players in real rooms.

The same authenticated player can rename its existing seat through the join operation using the room code and a new display name. The server validates name uniqueness and preserves member identity, assigned role, host and CEO authority, eligibility, contributions and history. Renaming is allowed in the lobby and active phases; ended evidence remains frozen. The in room edit control must display the returned server name rather than treating a local preference as a completed rename.

Lobby role choices are host draft state until Start. There is no individual lobby role mutation endpoint. Start requires all registered seats exactly once, at least three recently active members, admitted roles and timing, and exactly one CEO. Host and CEO permissions are distinct. New admission after Start requires a non CEO role and starts eligibility in the following round. There is no room leave or delete endpoint in this request layer.

The upload endpoint acknowledges a bounded local document payload. It does not store documents, run extraction, generate a scenario, or change the admitted scenario catalog. The real briefing must render the backend's released public documents and scenario reference. Upload success must not be presented as generated gameplay content.

This unit connects room admission and initial briefing. It does not implement automatic phase timing, speaking, voting, microphone recording, production transcription, original audio storage, AI evaluation or a complete game. Readable public briefing material remains available without paid provider calls.

## Verification

The focused service checks use injected fetch implementations and disposable JSON fixtures:

```sh
cd my-app
node --experimental-strip-types --test tests/rooms.test.ts
```

These checks cover exact routes and bodies, cookie credential options, caller command ID preservation, cancellation, domain errors, safe validation details, transport failure without automatic retries, malformed responses, and started public documents. They are request layer evidence and do not establish browser CORS, real multiplayer UI synchronization or deployment behavior. Those checks require a running frontend, backend and separate browser identities.

## Local browser integration evidence

An independent browser check on November 7, 2026 used the isolated worktree's FastAPI at `http://127.0.0.1:18001` and Vite at `http://127.0.0.1:4177`, with that exact frontend origin allowed. Four separate browser contexts registered their own membership through the visible UI. No cookie values or browser storage were inspected.

1. The host created a room. Two members left Start disabled. Guest role controls were disabled and the guest had no Start button.
2. Three distinct browser members reached the same room UUID. The host selected security for itself, CEO for the first guest and finance for the second guest. The host remained distinct from the CEO.
3. Host Start returned `briefing` at room version 4. All three browsers displayed the server phase, assigned roles, and the released `briefing`, `initial_evidence` and `operations` documents. A guest full refresh retained the same seat and briefing with no runtime exception.
4. A fourth browser initially received the required late role prompt. Its selector excluded CEO. Joining as operations produced room version 5, eligibility beginning in round 2 and `eligible_current_round: false`. All four authenticated snapshots agreed on the room and retained the original three member electorate.
5. The briefing screenshot was visually reviewed. The optional upload explanation clearly says acknowledgement does not change the scenario.

An initial development hot reload changed hook order while the UI worker edited a hook during the check. A full reload recovered; subsequent verification used the frozen source. This was a development update artifact rather than evidence of a fresh page failure.

Local evidence is retained under the ignored `.local/room-start-qa/` directory, including a compact summary, four public response projections and the reviewed screenshot. The four task browser targets and contexts were closed, the exact browser lease was released, and both disposable servers were stopped. This verifies local room admission through briefing and late eligibility. It does not establish deployment, speaking, voting, automatic progression, audio or AI evaluation.


## Independent tabs and rename verification

The user approved separate player identities for tabs in one browser, plus renaming an existing seat. The new guest bootstrap does not set a cookie and never accepts a public member UUID as authentication. Existing cookie clients remain compatible. A provided invalid session header cannot borrow a cookie identity.

Actual browser checks used three pages in one browser context with ordinary shared cookies, without inspecting cookie values, session storage contents or authentication headers. Distinct member IDs reached the same real room. Lobby and active CEO renames propagated to other tabs while IDs, roles, host and electorate stayed unchanged. Full refresh retained the seat. An actual opener copied tab forked its copied private identity and joined as a separate fourth late player. Duplicate names produced a visible error without changing the original seat.

The complete check passed with Web Locks and again with the BroadcastChannel fallback. The first attempt's background polling timing failure remains preserved. The final source adds immediate focus and visibility recovery, with a regression check, and preserves the original toolbar layout. Final frontend build, lint and 58 tests passed. Backend tests passed 96, existing Python tests 31 and narration player checks 7; the authored offline prototype demo passed. Browser targets, lease and disposable servers were cleaned up. Ignored evidence is under `.local/tab-players-qa/`, including both coordinator summaries and reviewed screenshots.
