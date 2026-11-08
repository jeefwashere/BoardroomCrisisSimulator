# Backend function guide

This guide summarizes the two backend design documents so the team can understand what to build, how the backend is organized, and which decisions are confirmed. The complete constraints remain in the [specification](backend-spec.md) and [architecture](backend-architecture.md). Track actual development progress in the root [TODO list](../TODO.md).

## 1. What the two documents cover

`backend-spec.md` describes product behavior and acceptance criteria: how players enter rooms, speak, propose actions, vote, see consequences, and finish a session. It distinguishes confirmed requirements, proposed defaults, optional features, and deferred work.

`backend-architecture.md` describes how the backend could implement those functions: module ownership, data structures, game state transitions, APIs, live synchronization, AI calls, concurrency, and deployment boundaries. Its full game functions and types remain design sketches. The first runnable lobby capability is documented in [room-api.md](room-api.md).

## 2. Complete game flow

1. The host selects a scenario and creates a room through Jeff's frontend, which generates the room code.
2. Players join with the room code and a display name. Starting requires at least 3 players; capacity is 30. New participants may join after start, with participation beginning in the next round.
3. Players select roles in Jeff's lobby. The host submits the room code, players, and selected roles together on Start. Players can have different responsibilities, but private scenario information for individual roles is not required.
4. Everyone reads the current crisis background, then speaks in sequence. There is one active speaker at a time, and the backend manages the countdown.
5. The system presents prepared choices. Players can also submit their own action proposals during the allowed phase.
6. When speaking finishes, choices freeze and a 60 second vote begins. Every player has equal voting weight.
7. The action with the most votes wins. When leading choices tie, the CEO selects among them.
8. A prepared winner applies the consequence written in the scenario. A custom winner is evaluated by AI, which returns an allowed outcome.
9. The backend updates the situation, records the decision, synchronizes all players, and automatically advances to the next round.
10. The game ends when the decision sequence finishes or total time expires. Results include decision history and AI feedback.
11. The meeting continues during a player's temporary disconnection. On return, that player recovers the same seat, vote, and current progress.

## 3. Confirmed function scope

1. Rooms and members: room creation, room code entry, display names, player limits, roles, and host and CEO permissions.
2. Scenarios: background material, prepared questions and answers, corresponding consequences, subsequent rounds, and endings.
3. Speaking: sequential turns, the current speaker, and a speaking countdown.
4. Voting: a 60 second period, equal weights, tallying, and CEO tie decisions.
5. Custom actions: players propose alternatives beyond the prepared choices, and AI evaluates them.
6. State synchronization: all clients see the same room phase, remaining time, and final outcome.
7. Automatic progression and ending: decisions advance the session; total timeout and scenario endings can both finish it.
8. Feedback: preserve what happened during the game and produce results with AI feedback.
9. Basic rejoin: recover the same player identity after refresh or temporary disconnection, avoiding duplicate votes.

## 4. Rules that remain proposals

The following values are not confirmed team decisions. Record the final selections before implementing them.

1. Each player speaks for 30 seconds, in room entry order.
2. Players can change their votes before close. Individual choices and aggregate counts remain hidden until the deadline.
3. Keep the full 60 second voting window even if everyone votes early.
4. Missing votes count as abstentions. A round with zero votes follows the scenario's explicit no decision outcome.
5. The CEO has 30 seconds to resolve a tie. If absent, the host can openly reassign the CEO role.
6. Each player can submit one custom proposal per round, with a maximum of 1,000 characters. Its text freezes when voting begins.
7. Evaluate only the winning custom action to reduce AI requests and waiting time.
8. AI maps a custom action to an outcome allowed by the scenario. The backend applies that outcome's narrative fact updates and next node.
9. An AI evaluation attempt has a 15 second timeout, followed by one explicit retry opportunity if it fails.

Confirmed separately: show a nonterminal result for at least 30 seconds after commitment, and end terminal outcomes immediately while retaining their text. The internal guard is implemented; automatic scheduling remains deferred.

Total game duration, the actual scoring rubric, and the complete role list still need team decisions. The speech and model providers are selected in [ai-architecture.md](ai-architecture.md). For example, 30 players speaking for 30 seconds each require 15 minutes for speaking alone. Select the total duration alongside player count and the number of rounds.

## 5. Backend organization

Start with one FastAPI service and one authoritative state per room. Browsers submit actions over HTTP and receive current room views through WebSocket connections. The backend decides winners and round transitions. AI returns evaluated data for the backend to validate and apply.

The current backend contains `main.py`, `models.py`, `rooms.py`, `simulation.py`, `scenarios.py`, and `narration.py`. HTTP routes currently live in `main.py`; wire models live in `models.py`. The following full game module map remains a proposal, including the separate `api.py` and `intelligence.py` modules:

1. `main.py`: application startup and lifecycle.
2. `api.py`: HTTP routes, WebSocket connections, input validation, and public data.
3. `models.py`: data structures for players, choices, votes, phases, and decision records.
4. `rooms.py`: membership, permissions, timers, duplicate request handling, and the sole entry for room state changes.
5. `simulation.py`: compute the next state from the current state and a valid action.
6. `scenarios.py`: load, validate, and pin scenario versions.
7. `intelligence.py`: call AI, check its response, and return a usable evaluation.

## 6. What AI can do

AI can use the background, current situation, player choices, and scoring rubric to explain an action's strengths, risks, and consequences. It can also generate feedback at the end.

The proposed design lets the scenario define allowed outcomes. AI selects one of them for the winning custom action. The backend verifies that the outcome belongs to the current scenario before updating narrative facts and story progress. This preserves the team's prepared happy paths while supporting players' own ideas.

If AI times out, returns an unknown outcome, or responds after the game ends, the backend shows the actual failure or unresolved state. Completed votes and decision records remain available when AI fails.

## 7. Required APIs

See the architecture document for complete paths. The main groups are:

1. Read scenarios and background material.
2. Create a room, join it, and read its current state.
3. Assign roles, start a meeting, and explicitly end it.
4. Finish the current player's speaking turn early, or skip a turn under the selected policy.
5. Submit, edit, or withdraw the player's own custom action.
6. Submit a vote and replace it if the final policy permits.
7. Resolve a tie as CEO.
8. Request an allowed retry for a failed AI evaluation.
9. Retrieve the final report.
10. Receive live state through a WebSocket connection.

## 8. Correctness boundaries

1. Multiple pages opened by one player still represent one voting member.
2. Network retries must preserve a single vote and apply each consequence once.
3. The backend checks deadlines. An expired request cannot change a closed vote.
4. Timers and AI responses from an old round cannot affect a newer round.
5. Each room keeps its members, votes, and story state isolated from other rooms.
6. Rejoin restores the original identity. Entering the same display name alone cannot reclaim a seat.
7. Final feedback must match actual decision records and outcomes.

## 9. Selected, optional, and deferred features

1. Generating three scenario documents with AI is an optional content tool. Cybersecurity is one example already mentioned; the other topics and document structure remain unselected.
2. ElevenLabs speech input and output are selected under Route A. Recording each participant's own speaking turn, retaining original audio and its attributed transcript during play, and showing accumulated records at game end for later AI evaluation are confirmed requirements. Exact capture transport and storage backend remain unselected. Production recording, transcription, original audio storage, and the complete media client remain unimplemented; the current reviewed text endpoint and speaking countdown do not establish them.
3. Database persistence, server restart recovery, and multiple backend processes are deferred. The proposed initial memory design supports reconnects only while the backend process remains alive.

## 10. Completion and evidence

The specification and architecture were published to `main` through [PR 1](https://github.com/jeefwashere/BoardroomCrisisSimulator/pull/1). That completes the documents. Backend functionality still requires implementation and verification before its tasks can be checked.

The root `TODO.md` lists tasks and acceptance requirements by function. After completing and verifying a task, each agent confirms that its implementation commit has been pushed, checks the task, adds the commit link and verification result, and pushes the checklist update.

## Selected speech and local model architecture

Route A is now selected: the application backend owns room state and permissions, ElevenLabs handles speech recognition and generation, LFM3 handles local conversational inference, and GLiNER extracts information. The eight logical roles and their actual implementation status are recorded in [ai-architecture.md](ai-architecture.md). Do not substitute OpenRouter or the legacy managed ElevenLabs mood agent.

Teammates call the hosted HTTPS API from their application server. They do not need the owner's Velocity account or SSH access. Application users need no ChatGPT account. Keep service credentials on the backend and do not distribute the developer's entire `.env.local`.

The `rehearsal/` package is a tested experiment. Its chair confirmation, 15 minute fixture, and SQLite history do not replace the confirmed voting, CEO, and FastAPI room requirements. Two models are enabled; seven other checkpoints are downloaded only. Speech adapters exist, but paid audio and a live microphone client have not been verified. Keep production backend and multiplayer integration tasks open until their own acceptance criteria pass.

The latest selected unit uses narrative consequences without fixed gameplay meters and preserves all answers, typed chats, and reviewed speech transcripts for later AI evaluation. See [the narrative engine guide](narrative-engine.md) for implemented execution, evidence, and narration boundaries.

## Facilitation

`backend/app/facilitation.py` adds an advisory opening briefing, facilitator, IT and journalist consultations, optional budgeted speech through the existing `NarrationService`, and a public catalog of the prerecorded fictional clips in `playtest/recordings/`. Text comes from the hosted model when configured; otherwise a clearly labelled offline reply grounded in public documents is returned. These features cannot vote, pass a turn or change a result. See [facilitation-api.md](facilitation-api.md) for routes and response shapes; tests live in `backend/tests/test_facilitation.py`.
