# Narrative execution, evidence, and consequence narration

The selected production direction has no fixed numerical gameplay meters. Prepared choices change narrative facts, produce text describing what happened, and move the story toward an authored ending. Every committed individual answer, chat, and reviewed speech transcript is retained for a later AI evaluator, including unselected answers.

This unit implements the internal narrative foundation. It does not install the speaking, voting, CEO routing, automatic scheduling, or AI scoring modules. A trusted test driver supplies resolved decisions directly to the engine. Application users receive no HTTP route that lets a host substitute a choice for the normal vote.

## Run one complete example

From the repository root, using the environment in [room-api.md](room-api.md):

```sh
backend/.venv/bin/python -m backend.narrative_demo
backend/.venv/bin/python -m backend.narrative_demo --fake-audio
```

Both commands start and stop their own localhost HTTP server on an available port. Four independent cookie clients register, three initial members start, and a trusted internal driver executes three prepared decisions with a controlled test clock. A late observer enters the next electorate. Ten attributed contributions, including unselected answers and reviewed transcript fixtures, are exported to the ignored `artifacts/narrative-demo.json`.

The default command disables speech. The second command verifies media protocol sharing using explicitly fake bytes; it does not generate or play spoken audio. Neither command calls a paid provider, microphone, transcription service, or AI. The fixture does not demonstrate human playtime or a complete deployed frontend.

## Scenario version 3

The active package is [v3](../scenarios/cybersecurity_demo/v3/scenario.json), schema `draft.2`. Versions 1 and 2 remain byte unchanged as historical packages and are not admitted by the active catalog. The new package removes numerical meter fields while preserving the three decision nodes, nine prepared choices, twelve outcomes, initial facts, allowed custom outcomes, and narrative endings.

The catalog validates graph references, termination, unique IDs, exact scalar fact types and patches, public document containment, narration text bounds, and timing arithmetic. It retains immutable execution records rather than discarding them after validation. A content digest pins the JSON and public document bytes. Fixed meter fields are rejected in the new schema. Incident quantities inside the story remain narrative facts, not gameplay grades.

## State and ownership

`Rooms` remains the only writer of room state, membership, contributions, versions, and receipts. `simulation.py` calculates immutable replacements. The API translates authenticated commands and projects only released information.

The implemented internal path is:

```text
briefing -> decision -> result -> decision -> result -> decision -> ended
```

1. Start initializes briefing and preserves the existing membership and first electorate.
2. `BeginDecision` requires the authored briefing period to have elapsed and exposes the current situation and prepared labels. Situation templates use committed facts.
3. `ResolvePrepared(option_id)` applies that node's authored outcome. `ResolveNoDecision()` follows the explicit authored no decision outcome, without inventing agreement.
4. A nonterminal outcome enters result with an earliest advancement time exactly 30 seconds later. Captions are the literal committed outcome text.
5. `AdvanceResult` checks the server monotonic clock, moves to the next node, increments the round, and freezes the newly eligible electorate. A new phase UUID rejects old callbacks.
6. A terminal outcome enters ended immediately, retaining the last result, history and narration caption. New gameplay input and new seats are rejected; existing members can still read or recover their seats.

The clock supplies guards, not a running scheduler. Passing wall time or polling GET never advances this foundation by itself. Later timer and voting components must submit trusted events through the same owner.

```python
from uuid import uuid4
from backend.app import simulation as sim

# Trusted integration code only, never a player HTTP payload.
state = await rooms.transition_internal(
    room_id, uuid4(), expected_phase_id, sim.BeginDecision())
state = await rooms.transition_internal(
    room_id, uuid4(), state.phase.phase_id, sim.ResolvePrepared("contain_targeted"))
# After the result guard has elapsed:
state = await rooms.transition_internal(
    room_id, uuid4(), state.phase.phase_id, sim.AdvanceResult())
```

Internal receipts bind room, event UUID, expected phase and exact event content. Exact replay returns the original immutable result before stale phase checking. Conflicting reuse, unknown options, early advancement, and new stale events fail without partial history or fact changes. Different rooms have separate mutation locks and receipt scopes.

History records the question known at the time, selected action or explicit no decision, outcome, literal consequence text, facts before and after, linked contribution IDs, round identity, and server timestamp. Future nodes, outcome maps, preferred answers, and custom rubrics stay private. Current snapshots expose the released node and committed history only.

## Record every answer and chat

Each browser uses its existing cookie. POST `/api/rooms/{room_id}/contributions`:

```json
{
  "command_id": "c3366ab6-255f-4fc6-9dc3-9f920cf834aa",
  "phase_id": "d7817875-919b-4c3a-904b-f6e95a1f0fa6",
  "kind": "answer",
  "source": "typed",
  "text": "Isolate the affected finance devices and preserve the available logs."
}
```

`kind` is `answer` or `chat`. `source` is `typed` or `speech`. Text contains 1 to 4,000 characters and is retained verbatim after nonempty validation. Submitting source speech means explicitly committing final reviewed transcript text. This endpoint does not record a microphone, run transcription, or retain original audio. It does not create a custom voting option or cast a ballot.

The server assigns contribution UUID, chronological sequence, member identity, role at submission, room association, phase, round, node, and UTC timestamp. Clients cannot supply another member identity or a server timestamp. An exact successful retry returns the original contribution with HTTP 201; changed content under the same accepted command ID is a conflict. Multiple answers with different IDs are preserved separately, not overwritten.

Answers require the current decision phase and frozen round eligibility. Chat is accepted in the lobby and active game phases, including result presentation and next round observers. Lobby chat uses null phase and round IDs. A phase change rejects a stale new submission, so the frontend must refresh and retain the user's text for an explicit retry. Ending freezes new contributions. Exact earlier receipts remain readable through retry.

GET `/api/rooms/{room_id}/contributions` returns all committed entries to a room member. There is no silent last N truncation. State is still process memory and is lost on backend restart.

## Confirmed future speaking recordings

The user requires every participant to be recorded during their own speaking turn, with backend ElevenLabs transcription running while the game continues. Retain both original audio and its transcript, linked to authenticated member, room, round, speaking turn, and timestamps. At game end, show the accumulated records and make them available to later AI evaluation.

This is a confirmed requirement for later implementation. Current reviewed transcript ingestion preserves submitted text only. Production microphone capture, transcription jobs, original recording storage, speaking turn linkage, and the end screen are not implemented by this unit. Capture transport and storage backend remain unselected. Permanent provider keys stay on the backend; the existing zero spending default and paid call authorization rules remain in force. Provider capabilities are described in [the selected speech architecture](ai-architecture.md).

## Evidence for the later evaluator

After ending, GET `/api/rooms/{room_id}/evaluation-evidence` returns the complete immutable factual bundle to an authenticated room member. Before ending it returns `409 evidence_not_final`.

The bundle includes scenario identity and digest, public materials, start and end timestamps, ending, members and roles, join timestamps and first eligible rounds, every committed decision and fact snapshot, and every accepted answer, typed chat and speech transcript in order. Unselected answers and observer chat remain present. Decision records link the contributions available by the decision's cutoff; result chat is retained in the complete export without rewriting that prior snapshot.

AI scoring is not implemented by this export. The later evaluator must process all records within the hosted model's bounded context, partitioning and citing evidence rather than silently dropping messages. No fixed gameplay grade or inferred psychological profile is produced here.

## Text first, then narration

A result or terminal snapshot exposes `game.narration` with `narration_id`, `phase_id`, and the exact committed `text`. Caption state is committed before media preparation. No client submits arbitrary text for paid generation.

1. GET `/api/rooms/{room_id}/narration/{narration_id}` reads media status.
2. POST the same path with `/prepare` generates or reuses that narration when explicitly enabled.
3. GET the same path with `/audio` serves authenticated audio bytes after preparation.
4. POST the same path with `/delivery` and `{"event":"started"}`, `completed`, or `failed` records that member's media event. Completion requires a prior started event and never grants gameplay authority.

A status response contains `status`, `text`, `error`, and `audio_url`. Status is disabled, pending, ready, or failed. All members may fetch the same prepared bytes; duplicate requests share one task and do not multiply generation charges. Provider work runs outside room locks and outside the event loop. Cancelled HTTP requests do not cancel or duplicate an already started generation. Failed attempts are not automatically regenerated.

The server rechecks membership and the current narration before and after preparation, before fetch, and before delivery acknowledgement. Phase changes and the 30 second nonterminal result cutoff expire narration with HTTP 410. The terminal result remains available. The separate player stops old playback when the next poll changes or removes the narration. Already buffered audio requires that client cancellation behavior; the backend cannot revoke local bytes.

## Browser integration example

[The isolated player](../backend/examples/narration-player.mjs) is separate from Jeff's frontend. Import it into the eventual gameplay page, feed every room snapshot into `update`, render captions with text content, and connect a Play button when `needsGesture` is true.

```js
import { createNarrationPlayer } from "./narration-player.mjs";

const player = createNarrationPlayer({
  roomId,
  setCaptions: (text) => { captionElement.textContent = text; },
  fetch: (path, options) => fetch(`${API}${path}`, options),
  onState: ({ needsGesture }) => { playButton.hidden = !needsGesture; },
});
playButton.onclick = () => player.play();
// After each authenticated room poll:
await player.update(snapshot);
// When leaving the page:
player.stop();
```

The player renders captions first, requests audio with credentials, tries playback, and handles browser gesture restrictions. Delivery reports come from playing and ended events rather than assuming a successful request means the user heard audio. The seven Node checks use fake media events; real browser playback remains unverified. See [the documented play promise](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play).

## Speech configuration and current boundary

Speech is disabled by default. The existing selected adapter uses ElevenLabs Flash 2.5 and a maximum of 500 caption characters; all current outcome summaries fit. No fallback provider is substituted. Captions and the text game remain usable when speech is disabled, setup fails, or generation fails.

An authorized operator must supply all of these server settings before real preparation can run:

1. `BOARDROOM_TTS_ENABLED=true`.
2. A positive, authorized `BOARDROOM_VOICE_BUDGET_USD`.
3. A verified `BOARDROOM_TTS_USD_PER_1K` for the actual account and selected model.
4. `BOARDROOM_TTS_VOICE_ID` from an approved account voice.
5. An explicit shared `BOARDROOM_TTS_LEDGER` for the existing USD reservation adapter, and optionally `BOARDROOM_TTS_CACHE`.
6. The permanent server only `ELEVENLABS_API_KEY`.

Do not copy the environment into a browser. Do not reuse or bypass the separate experiment's credit ledger or budget. Failed or uncertain calls retain their reservation; keep the ledger and cache. The configuration guard is not permission for this agent to run billable tests. Actual speech requires the budget authorization in [AGENTS.md](../AGENTS.md). No paid call or audible playback was performed for this delivery.

The provider contract follows [ElevenLabs create speech documentation](https://elevenlabs.io/docs/api-reference/text-to-speech/convert). Published prices are on [ElevenLabs API pricing](https://elevenlabs.io/pricing/api); verify the applicable account rate before spending rather than embedding a guessed price in code.

## Design synthesis and verification

Architect compared two independent candidates: direct Room phases and a pure immutable simulation module behind Rooms. Available tools expose OpenAI only, so both inherited the parent model and no judge from another family was available. Scores from 1 to 5 for requirement fidelity, one writer, evidence completeness, immutable execution, bounded media effects and verification footprint: A scored 5, 5, 5, 4, 4, 3; B scored 5, 5, 5, 5, 5, 4. Choose B. Adopt A's frozen terminal evidence and server monotonic presentation guard. Reject contribution writes after ending and reject public resolution shortcuts. Media owns bytes and delivery reports; it cannot change the story.

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -v
node --test backend/examples/narration-player.test.mjs
python3 -m unittest discover -s tests -v
python3 -m rehearsal demo --output artifacts/narrative-module-prototype-demo.json
```

Coverage includes all 64 prepared and no decision paths, fact preservation, rendered situations, timing guards, history, duplicates, stale phases, room isolation, late electorates, complete contribution export, public projection, narration access, concurrent shared generation, cancellation, setup failure, and browser playback promises. B03 and the B04 foundation are eligible for completion after verified publication. B12 and O02 remain partial until actual AI evaluation and the live client media flow pass their own acceptance criteria.
