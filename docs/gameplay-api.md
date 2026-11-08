# Prepared gameplay HTTP API

The backend now runs the prepared scenario flow automatically. Start uses the existing request and the explicitly selected scenario timing profile. This delivery implements B05, B06, B07, B08, B11 and B13 for prepared actions. Custom proposals, custom outcome inference, final AI feedback, participant audio and the gameplay frontend remain separate work.

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

A FastAPI lifespan task reconciles rooms every 100 milliseconds. Authenticated commands and snapshots also reconcile under the same room lock before changing presence or accepting actions. No browser request is needed to move time forward. The deadline remains authoritative even when a wakeup is late. No public host command selects an ordinary vote winner.

`backend/app/gameplay.py` computes immutable replacements. `Rooms` alone publishes them under its existing lock, increments room versions and retains receipts. Timer work, HTTP commands and rejoin therefore share one authority. Provider work is outside this delivery. The explicit `automatic=False` construction is used only by internal narrative foundation fixtures and their demo; normal application construction enables gameplay.

The lifecycle follows the official [FastAPI lifespan guidance](https://fastapi.tiangolo.com/advanced/events/). Tests also exercise startup and cancellation as described in [FastAPI testing events](https://fastapi.tiangolo.com/advanced/testing-events/).

## Authentication and snapshots

Retain the current tab session contract: initialize or resume with `POST /api/tab-sessions`, then send the private `X-Boardroom-Session` header. Legacy cookie clients remain supported. A room code, display name, role or member UUID never authenticates another seat.

`GET /api/rooms/{room_id}` returns the existing room fields and these gameplay fields:

1. `phase`: `briefing`, `reading`, `speaking`, `discussion`, `voting`, `tie_break`, `result` or `ended`. The older `decision` phase remains limited to internal foundation fixtures.
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

The current frontend request validator accepts only the earlier phases. Frontend integration must add the new phase union and gameplay fields, then bind these commands and displays before this backend is activated in the shared interactive environment. No frontend source, existing local server, cloud deployment, WebSocket delivery, model service, microphone, original audio store or paid provider was changed by this unit. I01, I02, I03, B09, B10, B12 and O02 remain open for their full criteria.
