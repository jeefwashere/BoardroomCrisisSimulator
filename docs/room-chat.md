# Room discussion records

The room discussion uses the existing authenticated contribution endpoint described in [narrative-engine.md](narrative-engine.md). A submitted chat becomes a server record attributed to the tab's authenticated member. It does not cast a vote, resolve a decision, generate AI feedback or capture audio.

## Request contract

`my-app/src/services/rooms.ts` exports `ContributionInput`, `Contribution`, and two `RoomApi` methods:

```ts
api.contributions(roomId, signal?) // GET all committed records
api.contribute(roomId, input, signal?) // POST one final contribution
```

Both methods address `/api/rooms/{room_id}/contributions`, escape the room ID and use the existing private tab session header and cookie credential option. Reads return the entire server array without a last N limit, filtering by selected answers, or rewriting order. Each response must contain the complete public contribution shape; malformed entries reject the response rather than disappearing silently.

The caller creates this input once for an intended submission:

```json
{
  "command_id": "c3366ab6-255f-4fc6-9dc3-9f920cf834aa",
  "phase_id": null,
  "kind": "chat",
  "source": "typed",
  "text": "Preserve this text exactly."
}
```

Lobby chat uses `phase_id: null`. Active chat uses the current server phase ID. The backend validates nonempty text of 1 to 4,000 characters and retains accepted text verbatim. The browser never supplies the author, role at submission, sequence, round attribution or timestamp. Those fields come from the successful response and remain part of every record, including unselected answers and reviewed transcript text created by other clients.

## Retry and phase changes

The request layer does not generate command IDs, alter input or automatically repeat a POST. A successful response contains the committed record with HTTP 201. An exact explicit retry returns the original record.

A connection failure can occur after the server accepts a message. Retain the entire original input, including its command ID, phase ID and text. An explicit retry must send those exact values even if a later room snapshot shows a different phase. The backend checks an existing receipt before rejecting a stale phase. Rebuilding an uncertain request with the new phase could cause a command conflict or duplicate contribution.

A newly rejected `stale_phase` request has no accepted receipt. Preserve the user's text, refresh the room, and require an explicit corrected submission against the new phase. New chat is accepted in lobby, briefing, decision and result, including for next round observers. Ended rooms reject new writes with `game_ended`, while members may continue reading committed records. Exact previously accepted receipts remain recoverable after ending.

`RoomApiError` preserves domain status and code. Validation details omit submitted input and context. Cancellation keeps the original abort error. These behaviors follow the existing room request helper; Fetch status and cancellation semantics are documented in [MDN's Fetch guide](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch).

## Verification and boundaries

Focused request checks run without a browser or live provider:

```sh
cd my-app
node --experimental-strip-types --test tests/rooms.test.ts tests/contributionsApi.test.ts
```

The contribution checks cover private tab options, escaped routes, exact request bodies, server attribution, complete ordered history beyond 100 entries, unselected answers, reviewed text, explicit uncertain retries, stale phases, permissions, ending errors, malformed records, validation and cancellation. These are request contract checks. Actual browser synchronization and rendered behavior require a separate running frontend and backend check, which must be recorded with its own evidence.

Actual browser acceptance on 2026 November 8 used three independent tabs in one managed Chrome context against a disposable real FastAPI service. All tabs saw the same ordered lobby messages and real briefing. The open panel and unsent draft survived Start; renamed and refreshed members retained their seat and complete records. Submission roles and phase labels came from server records, and HTML looking text remained literal text. One response was deliberately lost after a server 201 commit. Another tab saw record seven before the explicit retry; retry recovered the same contribution ID while the server count stayed seven. A fourth real member could chat as a next round observer without changing the current electorate; the three original tabs then showed eight identical ordered records. A scoped ended snapshot fixture retained all eight records and removed the composer; the actual room stayed in briefing. Desktop and 390 pixel mobile screenshots were reviewed, with no horizontal overflow. All four browser targets, the exact managed lease and both disposable servers were cleaned up. Build, lint, 83 frontend tests, 96 backend tests, 31 existing Python tests, seven narration player checks and the offline demos passed. See [sanitized browser evidence](evidence/room-chat-browser-20261108.json). These checks do not establish a completed voting game or paid speech integration.

The current backend stores rooms and contributions in process memory. Refresh recovery while the backend runs does not establish restart durability. This unit makes no provider call and does not implement microphone recording, production transcription, original audio storage, automatic game progression, voting, or AI evaluation.


## Shared speaking transcripts

Room chat also renders each participant completed speaking transcript from the authenticated read only GET /api/rooms/{room_id}/recordings route. This route returns the existing RecordingView metadata and text for members of that room and does not start feedback or invoke a provider. Recognition awaiting review is labelled Unreviewed speech transcript. Explicit owner review replaces the same recording row with reviewed_text and a Reviewed speech transcript label. Displaying recognition does not commit it as a human answer or mark it reviewed.

The chat store polls contributions and recordings on the existing cadence, deduplicates recordings by identity and orders the combined display by time. Incomplete or failed recognition produces no fabricated text. Public typed messages remain visible during individual decisions; only individual decision answer records are excluded from chat. The personal AI summary and final decision remain in Your decision. History retains a132 pixel minimum so transcript text remains visible beside the decision composer.

Validation:259 frontend tests, lint and build pass.20 recording and summary backend tests pass, covering room isolation, same room shared reads, review replacement, provider call deduplication and no feedback side effect. The browser used three independent test memberships and real MediaRecorder encoding with a fixture transcriber. Each member saw the same transcript; a correction replaced one row; public chat during decisions remained visible; a private confirmed answer stayed out of the history. A fresh page load showed successful recording and contribution polls, with no new console or window errors. One earlier HTTP409 during timed phase traversal remains in the evidence instead of being discarded. No new paid provider call was made for this presentation test. See [browser evidence](evidence/room-chat-speech-browser-20261108.json).


The shared speech display work42cecbb was pushed and complete remote equality verified. The local frontend was rebuilt and owned services restarted at14:25UTC on November8. Current page, local and LAN API health, chat modules and the member scoped recording GET route pass readback. Restart resets rooms; refresh the demo and start a fresh room. Existing speech settings and shared ledgers are preserved.
