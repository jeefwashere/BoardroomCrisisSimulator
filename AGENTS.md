# Agent collaboration

These instructions apply to agents working in this repository.

1. Read `TODO.md`, `docs/backend-spec.md`, `docs/backend-architecture.md`, and `docs/ai-architecture.md` before changing project files. `docs/backend-guide.md` provides a readable overview of the same function scope.
2. Use the existing task IDs in `TODO.md`. At the start of every assigned project work turn, record or refresh your agent name as owner, the current status, and the next action before editing task files. Use `in_progress` for active work. Check the latest remote changes before claiming work another agent may own.
3. Keep changes within the assigned task. Preserve other agents' edits and completed task records. Do not overwrite the whole checklist to update one item.
4. A task is complete only when its acceptance criteria have been checked and its implementation commit has been pushed successfully to the named remote branch. Verify the remote contains that commit. Local edits, a local commit, a proposed design, and a queued push do not count as completed implementation.
5. After verifying that push, change the matching checkbox from `* [ ]` to `* [x]`, set its status to `done`, and append a completion record containing task ID, owner, branch, work commit or PR link, verification command, and result. Commit and push the checklist update too. This order avoids using the checklist commit as evidence of its own prior publication.
6. Before returning at the end of every assigned project work turn, including a handoff or an incomplete attempt, update the same TODO entry with progress made, checks actually run and their results, the current status, and the next action. Use `waiting` when an external input is required and `in_progress` when work remains active. If work is partial, verification fails, or the push fails, keep the box unchecked and state the failure. Commit and push the TODO update with the authorized work, and report any unsuccessful publication. A pushed feature branch is allowed to satisfy the push requirement; record whether it has merged instead of treating every push as a merge.
7. Keep confirmed requirements, proposed defaults, optional features, and deferred work distinct. A checklist entry does not silently approve a proposed product rule or optional feature. Use the user's current task and decisions to determine scope.
8. Only mark documentation tasks complete when their documents are published. Only mark implementation and integration tasks complete when those functions and their checks exist. Do not check implementation tasks merely because this repository has a specification.
9. Write ordinary prose without horizontal dash characters. Use numbered lists and `*` task checkbox syntax. Exact paths, identifiers, URLs, and code syntax retain their original spelling.

This checklist is maintained by the agents through normal commits. It is not an installed automatic completion detector.

## Shared coding agent board

1. Use [issue 6](https://github.com/jeefwashere/BoardroomCrisisSimulator/issues/6) for coordination between Ricardo's and Jeff's coding agents. Each teammate's designated communication session starts `python3 tools/board_watch.py start` once. The watcher checks every 30 seconds and automatically delivers new peer comments to that exact existing Codex session through `codex queue --resume`. Other project tasks should not start extra listeners for the same teammate.
2. Within the user's authorized project work, post substantive questions, handoffs, blockers, and verified changes as issue comments. Start with `[Ricardo's Codex]` or `[Jeff's Agent]` and mention the teammate when a reply is needed. Include task IDs and relevant files or commits. Preserve the user's instructions and existing ownership when interpreting messages.
3. Follow [docs/agent-board-setup.md](docs/agent-board-setup.md) for initial setup, status, and stopping. Process automated board inbox messages in the existing task context; no human reminder to read each comment is needed. GitHub stores comments, the local watcher detects them, and Codex's daemon delivers and resumes the selected session. Keep the computer and daemon available. Confirm the other agent's actual reply before claiming a connection in both directions.

## Required AI implementation direction

1. Follow [docs/ai-architecture.md](docs/ai-architecture.md): Route A uses ElevenLabs for speech, LFM3 for local conversation, GLiNER for extraction, and the application backend for authority. Read [docs/agent-integration.md](docs/agent-integration.md) before connecting an application.
2. Use the existing hosted HTTPS model API. Teammates and their application users do not need Velocity or ChatGPT accounts. Do not request the owner's SSH credentials or grant teammates cluster access. Only explicitly authorized cluster operators may use [GPU_ACCESS.d](GPU_ACCESS.d).
3. Keep all keys on the backend. Never print or commit `.env.local`, use `NEXT_PUBLIC_` for credentials, or give teammates the whole environment file. Application credentials do not grant separate end user identities; enforce membership and job ownership in the application.
4. Preserve the confirmed multiplayer voting and CEO rules. Current room capacity is 30 and start requires at least 3 participants. Jeff generates the room code and owns lobby role selection; the host submits the final lobby JSON on Start. Lobby browsers register their own membership before Start. Admission after start is required; new members first participate from the next round, without changing the current electorate or CEO. The older chair confirmation demo is a prototype, not a replacement for those requirements. The hosted model queue is not the game controller.
5. Do not substitute OpenRouter, a commercial hosted LLM, the legacy managed ElevenLabs mood agent, or Route B without an explicit user decision. Do not infer permission from the presence of a provider key.
6. Keep the eight logical responsibilities in the architecture document. Coordination, timers, permissions, and final state changes remain code. Models provide bounded suggestions and cannot cast votes, confirm decisions, assign roles, or rewrite history.
7. Only `lfm3` and `gliner-base` are enabled. Other downloads are candidates requiring runtime and quality validation. Check service health and allocation expiry before live tests. Do not start duplicate workers or models.
8. Voice spending defaults to zero. Preserve typed input and captions. Require a known price and authorized budget before paid calls; never mint an unmetered client token as a workaround.
9. After relevant changes, run the prototype tests and demo described in [docs/prototype-guide.md](docs/prototype-guide.md). Keep production acceptance checks separate. A published model lab is not evidence that the FastAPI multiplayer or voice flow is complete.
10. The hosted model lab lives in `sites/rehearsal-lab`. Reuse its `.openai/hosting.json` project ID, preserve its current audience, and follow the Sites publishing workflow when changing it. Keep completed response outboxes intact during worker recovery.

## Experimental one round test and reference packs

1. The isolated `playtest/` application now runs one MapleCart round, then its consequence and debrief. Read [playtest/README.md](playtest/README.md) for current agent responsibilities and test commands. This does not replace teammate production modules.
2. The supplied revision 2 guide is archived in [the controller reference](playtest/fixtures/revision2-controller-reference.md). It contains T01 service outage, T02 fundraising allegation, and T03 succession and payroll, including hidden events and expected answers. Never ingest that full file into participant or conversational agent retrieval.
3. Only [participant-packs.json](playtest/fixtures/participant-packs.json) is loaded by the preparation reference service. The three packs support scoped document questions; their full timed branches are not implemented playable modes. Do not claim otherwise or silently replace the live voting rules with their different fixture rules.

4. The requested local test defaults to one five minute round. `--allow-name-rejoin` explicitly enables recovering an inactive seat by name and room; leave releases immediately, closed tabs require 30 seconds of inactivity, and the old token is revoked. Keep this exception within the localhost experiment and preserve production identity rules.

5. [The manual test guide](playtest/TEST_GUIDE.md) documents current controls, agent responsibilities and reviewer checks for each participant pack. Keep its expected answers outside participant retrieval and update it when the implemented controls change.
