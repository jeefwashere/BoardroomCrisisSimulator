# Prepared gameplay HTTP API

The backend now runs the prepared scenario flow automatically. Start uses the existing request and the explicitly selected scenario timing profile. This delivery implements B05, B06, B07, B08, B11 and B13 for prepared actions. The complete frontend, custom outcome, feedback and participant audio extension is documented below and in the integration report.

## Confirmed policies

The user accepted these policies on November 7, 2026:

1. Use the selected scenario schedule. `standard_18` has a 90 second briefing, 60 seconds of reading per round, 150 seconds of shared discussion, 60 seconds of voting and 30 seconds of nonterminal result presentation. The gameplay ceiling is 1110 seconds from Start. The 18 minute profile also budgets debrief time; the total experience ceiling is 20 minutes. The existing `fast_15` profile remains explicitly selectable.
2. Freeze the round electorate and use stable seat order. Each eligible member receives at most 30 seconds, capped by `floor(discussion_seconds / eligible_members)`. Remaining time is open discussion. A late member first participates next round.
3. The current speaker may finish early. The host may skip with a recorded reason. A member whose authenticated presence expires is skipped, including when expiry occurs during that member's turn. Rejoining does not rewind turns. Presence continues to mean authenticated activity within a strict 30 second window; it is not immediate socket detection.
4. A member has one replaceable ballot until the strict server cutoff. Individual ballots and aggregate counts stay hidden while voting is open. A snapshot shows only the caller's current ballot. Voting retains the full 60 seconds even if everyone has voted. Same seat connections share one ballot; independently registered player tabs are separate seats.
5. Positive tied leaders enter a 30 second CEO decision. Only the current CEO may select among those leaders. If the CEO is offline, the host may publicly reassign that role to a connected eligible member. The old CEO receives that member's prior role. Reassignment does not restart the tie deadline. Zero votes and an expired tie use the authored no decision outcome.
6. The total deadline wins over every pending gameplay operation, including equality. On resuming an overdue process, total expiry ends the game without retroactively resolving pending rounds. Terminal authored outcomes end immediately; nonterminal results retain the 30 second guard.
7. Host ending and total timeout freeze the final factual evidence even when no decision has yet been made. Browser refresh and temporary disconnect preserve the original seat, ballot and current clock. Server restart recovery remains deferred.

## Automatic progression

```text
lobby -> briefing -> reading -> speaking -> discussion -> voting
voting -> result | tie_break | ended
tie_break -> result | ended
result -> reading
any active phase -> ended
```

With `"decision_mode": "individual"` (see Individual decision mode below) the round instead runs `discussion -> individual_decision -> ended`.

A FastAPI lifespan task reconciles rooms every 100 milliseconds. Authenticated commands and snapshots also reconcile under the same room lock before changing presence or accepting actions. No browser request is needed to move time forward. The deadline remains authoritative even when a wakeup is late. No public host command selects an ordinary vote winner.

`backend/app/gameplay.py` computes immutable replacements. `Rooms` alone publishes them under its existing lock, increments room versions and retains receipts. Timer work, HTTP commands and rejoin therefore share one authority. Provider work is outside this delivery. The explicit `automatic=False` construction is used only by internal narrative foundation fixtures and their demo; normal application construction enables gameplay.

The lifecycle follows the official [FastAPI lifespan guidance](https://fastapi.tiangolo.com/advanced/events/). Tests also exercise startup and cancellation as described in [FastAPI testing events](https://fastapi.tiangolo.com/advanced/testing-events/).

## Authentication and snapshots

Retain the current tab session contract: initialize or resume with `POST /api/tab-sessions`, then send the private `X-Boardroom-Session` header. Legacy cookie clients remain supported. A room code, display name, role or member UUID never authenticates another seat.

`GET /api/rooms/{room_id}` returns the existing room fields and these gameplay fields:

1. `phase`: `briefing`, `reading`, `speaking`, `discussion`, `voting`, `tie_break`, `result`, `individual_decision` or `ended`. The older `decision` phase remains limited to internal foundation fixtures.
2. `game.phase_id`, `round_id`, `round_number`, `server_time`, `phase_deadline` and `session_deadline`. Times are UTC projections of the server's monotonic clock. Clients display countdowns; they never advance gameplay.
3. `active_speaker_id`, `speaker_order`, `current_node`, prepared `options` and `eligible_member_ids`.
4. `self_vote`, `vote_counts`, `tied_option_ids` and caller specific `allowed_actions`. `vote_counts` is null throughout voting. No list of individual ballots is projected.
5. `turns` records authenticated member, round, phase, start, end, finish or skip reason and acting member. These are timing records, not audio recordings.
6. `ceo_changes` records previous CEO, replacement, host, round and time. Decision history includes committed counts and selection method.
7. `ending_label`, `ended_at` and immutable `history` remain readable after ending. Final evidence includes turns and CEO changes alongside contributions and decisions.

Snapshots never lower the room version. An exact command retry returns its exact prior response, which can have an older version than a later snapshot. Clients must continue discarding older versions. Presence and `server_time` can change on equal version snapshots. Private `self_vote` and `allowed_actions` differ between members.

## Commands

All gameplay mutations use POST, require the authenticated member, carry a UUID `command_id` and current `phase_id`, and return `RoomView`. Round commands also include the current `round_id` in their path. Reusing an ID with a different intent is a conflict; exact retries cannot repeat a side effect.

```text
POST /api/rooms/{room_id}/rounds/{round_id}/speaker/finish
{ "command_id": "UUID", "phase_id": "UUID" }

POST /api/rooms/{room_id}/rounds/{round_id}/speaker/skip
{ "command_id": "UUID", "phase_id": "UUID", "reason": "Requested a pass" }

POST /api/rooms/{room_id}/rounds/{round_id}/vote
{ "command_id": "UUID", "phase_id": "UUID", "option_id": "contain_targeted" }

POST /api/rooms/{room_id}/rounds/{round_id}/tie-decision
{ "command_id": "UUID", "phase_id": "UUID", "option_id": "contain_targeted" }

POST /api/rooms/{room_id}/rounds/{round_id}/ceo-reassignment
{ "command_id": "UUID", "phase_id": "UUID", "member_id": "UUID" }

POST /api/rooms/{room_id}/end
{ "command_id": "UUID", "phase_id": "UUID" }
```

Malformed requests return 422. Missing authentication returns 401. Wrong membership, speaker, host, CEO or electorate permissions return 403. A stale round or phase, ended game or conflicting command returns 409. An unknown prepared option or a CEO choice outside the tied leaders returns 422. At deadline equality, reconciliation occurs before command admission; a fresh vote is rejected even when the request was sent earlier.

`GET /api/rooms/{room_id}/evaluation-evidence` supplies the frozen factual report after an authored ending, host ending or total timeout. It does not invoke final AI evaluation.

## Verification and integration boundary

```sh
BOARDROOM_TTS_ENABLED=false backend/.venv/bin/python -m unittest discover -s backend/tests -q
BOARDROOM_TTS_ENABLED=false backend/.venv/bin/python -m backend.gameplay_demo
```

The socket HTTP demo starts and stops its own ephemeral loopback Uvicorn server. Four independent tab credentials complete three rounds, a positive CEO tie, late admission and a resumed connection. The resumed connection remains one voter. It retains nine attributed answers, eleven turn records, three decisions and frozen final evidence. The server clock is controlled to test the authored schedule promptly; this is not an eighteen minute human timing trial.

Regression checks cover 30 concurrent voters, replacement, hidden counts, exact retries, cutoff equality, stale round commands, repeated timer work, offline speakers, zero votes, CEO absence and reassignment, earlier and equal total expiry, ending before any decision, room isolation and lifespan cancellation. Reproduced late Start and create retries which could skip an online speaker are retained as regressions. Host ending invalidates prior consequence narration. The final backend suite passes 112 tests; 31 existing Python tests and seven narration player tests also pass.

## Custom actions, audio and final assessment extension

Snapshots also accept `resolving` and `resolution_failed`, include member proposals and resolution identity, status, attempt and fragment progress, and distinguish frozen custom options from prepared options. The same frozen option set drives voting and CEO tie selection.

```text
POST /api/rooms/{room_id}/rounds/{round_id}/proposal
{ "command_id": "UUID", "phase_id": "UUID", "text": "The exact custom action" }

POST /api/rooms/{room_id}/rounds/{round_id}/resolution/retry
{ "command_id": "UUID", "phase_id": "UUID" }

POST /api/rooms/{room_id}/feedback
{ "command_id": "UUID", "phase_id": "UUID" }
```

One editable proposal per eligible member per round is allowed during speaking, discussion or voting, with no product character cap. Empty text withdraws it. Revisions remain evidence (each submission is an attributed `answer` contribution). `allowed_actions` contains `"proposal"` for current round electorate members in those three phases; anyone else gets 403 `not_eligible`.

During voting the ballot is already frozen, so a proposal is added straight to it as a `kind: "custom"` option (with the proposer's `member_id`) in `current_node.options`, and every member can vote for it at once. While voting, the proposer may edit or withdraw their option only while it has zero ballots; once anyone has voted for it, both return 409 `proposal_has_votes`. An edit keeps the same `option_id` and ballot position. Ballots already cast for other options stay valid.

Only a winning custom choice (vote or CEO tie decision) enters a 15 second resolution attempt, with one explicit host retry after failure. When Vertex Gemini (`backend/app/vertex_text.py`) is configured it is tried first, for at most 10 seconds of that deadline: it must return exactly `{"outcome": "O1"}` naming one allowed outcome alias (or an exact allowed outcome ID); any other output or a provider error falls back to the hosted LFM resolver with the remaining time. A failure of both leads to the existing `resolution_failed` phase. Code admits only the current node's authored allowed outcomes. History retains proposer, selected text, selection method, job and attempt; ending retains unresolved selected text too.

`POST /api/rooms/{room_id}/recordings/begin` takes command, phase and round IDs. Upload original audio with `POST /api/rooms/{room_id}/recordings/{recording_id}` using `audio_base64` and `mime_type`. The original owner reviews with `POST /api/rooms/{room_id}/recordings/{recording_id}/review` and `{ "text": "reviewed transcript" }`. Member authenticated audio is available at the same recording path with `/audio`. `GET /api/rooms/{room_id}/extras` supplies contributions, recordings and final assessment status. Pending upload, transcription or owner review prevents premature assessment. Every route uses the private tab session header.

The actual custom winner, real voice provider and three tab end to end evidence, failure boundaries, storage and configuration are documented in [full game integration](full-game-integration.md). Shared activation and deployment remain I04. The historical 112 test count above describes the prepared delivery; final delivery checks are in completion record 21.

## Individual decision mode

A scenario timing profile may set `"decision_mode": "individual"` (default `"vote"`) and `"individual_decision_seconds"` (default 180). Both Cedar Bridge T01 profiles use `"individual"` with 180 seconds; every other scenario keeps `"vote"` and behaves exactly as before. The snapshot field `game.decision_mode` is `"vote"` or `"individual"` and is fixed for the whole game.

In individual mode the board does not vote. When the discussion phase ends (in Cedar Bridge, after the expert panel deadline or a host `skip_phase`), the room enters the `individual_decision` phase instead of `voting`. No ballot freezes, no outcome is resolved, AI ballot options are not drafted (`ai_options_status` is `"disabled"`), and `proposal` is not offered (a proposal command returns 409 `proposals_disabled`). There are no points.

Each electorate member writes one free text decision: what they would do, why, which information they used, and what they still need to establish.

```text
POST /api/rooms/{room_id}/rounds/{round_id}/decision
{ "command_id": "UUID", "phase_id": "UUID", "text": "1 to 1200 characters, not blank" }
```

1. `allowed_actions` contains `"submit_decision"` for current electorate members during `individual_decision`. Members who joined after Start get 403 `not_eligible`. Outside the phase the command returns 409 `not_individual_decision`; a stale phase or round returns 409 `stale_phase`; blank or overlong text returns 422.
2. Resubmission replaces the member's decision until the phase ends. Commands are idempotent by `command_id` like every other command; reusing an ID with different text returns 409 `command_conflict`.
3. Every submission, including replacements, is retained as an attributed contribution with `kind: "answer"`, `source: "typed"` and `phase: "individual_decision"`. While the game is running, `GET /contributions` and `/extras` show these only to their author. After the game ends they appear in the final records (`/contributions`, `/evaluation-evidence` and the final AI assessment) like other answers.
4. The phase ends as soon as every electorate member has submitted, when its deadline passes, or when the host uses `skip_phase` (now allowed in this phase). Profiles with `"private_rounds": true` (both Cedar Bridge profiles) then enter the `private_session` phase described below. Other individual mode profiles end with `ending_label: "individual_decisions_recorded"` and `ending_title: "Individual decisions recorded"`, with empty `history` and no vote outcome. Evaluation evidence and `POST /feedback` work as for other endings. `gameplay.finish_individual_decision` is the single place that chooses the next phase.

From the `individual_decision` phase onwards (and in the ended view) the snapshot includes:

```json
"individual_decisions": {
  "submitted": [
    {"member_id": "UUID", "display_name": "Alex", "role_name": "CEO", "submitted": true}
  ],
  "self": {"text": "the caller's own decision", "at": "ISO timestamp"}
}
```

`submitted` lists the round electorate in seat order. `self` is the caller's own latest decision or `null`. It stays available during `private_session`. Other members' texts are never projected in any snapshot, including after the end. `individual_decisions` is `null` in vote mode and before the phase. `game.ending_title` is `null` for every other ending.

## Rounds 2 and 3: private session phase

A timing profile in individual decision mode may set `"private_rounds": true` and `"private_session_seconds"` (default 1500). Both Cedar Bridge T01 profiles use `true` with 1500 seconds; every other scenario keeps `false` and is unchanged. `GET /api/scenarios` lists both values on each timing profile, and the snapshot field `game.private_rounds` is fixed for the whole game.

When the `individual_decision` phase ends (every member submitted, its deadline, or a host `skip_phase`), the room enters the `private_session` phase instead of ending. Every member of the round electorate then runs a private branch at the same time with one AI agent, labelled "Crisis coach": Round 2 coaching with a response card and no points, then Round 3, where the same agent becomes the examiner and scores three stages worth 30, 40 and 30 points. Branch content, routes and scoring are documented in [the facilitation API](facilitation-api.md#rounds-2-and-3-private-coach-and-examiner). The room only tracks each member's stage and the phase deadline.

1. `phase_deadline` is `private_session_seconds` after the phase begins. `session_deadline` is extended to at least that deadline so the Round 1 ceiling cannot cut the private rounds short.
2. `allowed_actions` contains `"private_session"` for electorate members during the phase. Members who joined after Start are not part of the electorate and get 403 `not_eligible` from the private session routes. The host keeps `"skip_phase"` and `"end"`.
3. The phase ends when every electorate member reaches `complete`, when its deadline passes, or when the host uses `skip_phase` (now allowed in this phase). The game then ends with `ending_label: "private_sessions_complete"` and `ending_title: "Private sessions complete"`. A host `end` still ends with `host_ended`. `gameplay.finish_private_session` is the single place where Round 4 (the board reunion) can begin instead of ending; Round 4 is not implemented.
4. Private answers, cards and scores are not room contributions. They never appear in `/contributions`, `/extras` or `/evaluation-evidence`, so no other member can read them, including after the end.

From the `private_session` phase onwards (and in the ended view) the snapshot includes progress without content or scores:

```json
"private_progress": [
  {"member_id": "UUID", "display_name": "Alex", "role_name": "CEO",
   "stage": "not_started | coaching | card | assessment | complete"}
]
```

`private_progress` lists the electorate in seat order and is `null` before the phase or when `private_rounds` is `false`. A stage only moves forward: `not_started` until the member first opens their private session, `coaching` during the Round 2 questions, `card` while the response card is drafted and reviewed, `assessment` during Round 3, and `complete` after the third stage is scored. Progress is frozen once the phase ends.

