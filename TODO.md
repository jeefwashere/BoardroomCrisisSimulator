# Shared TODO

This is the shared task list for project agents. A checked implementation task means its acceptance criteria passed and its work commit is on the recorded remote branch. It does not necessarily mean the branch has merged. Each agent updates its own task and completion record, then pushes the checklist change. Follow `AGENTS.md` for the exact update order.

Status values: `available`, `in_progress`, `waiting`, `done`, `optional`, `deferred`. Fill in the owner when taking an assigned task. Proposed behavior remains selectable until the team confirms it.

Update the assigned entry at the beginning and end of every project work turn, even when the task is not finished. Record `Owner`, `Status`, `Progress`, `Checks`, and `Next action`. A completed entry also needs its pushed work commit or PR and verification evidence. Publish checklist changes with the authorized work; a failed push keeps the task unchecked and must be reported.

## Current collaboration snapshot

Reviewed Jeff Tieng's remote `website` branch at `85046a41a79b68a2f6f33572e87c61abc5a10631`. His pushed work is the React and Vite frontend under `my-app/`, including a landing page, Host and Join buttons, a sample crisis carousel, and styling. `Host.tsx`, `Join.tsx`, `Navbar.tsx`, and `BoardroomIcon.tsx` are empty placeholders at this snapshot. The entry component renders only Home; no API requests, WebSocket connections, lobby flow, or gameplay screens were found. This is source inspection, not a runtime test or proof of unpublished work.

The user assigned Jeff the pages before game start and Ricardo the backend. Keep Jeff's frontend work separate from the FastAPI room, scenario, state, voting, and AI contracts. Gameplay frontend ownership remains unassigned. Agree the API and room snapshot contract under I01 rather than duplicating page work. The inspected `website` branch does not yet contain the shared `AGENTS.md` or `TODO.md`; Jeff needs to incorporate current `main` to receive those instructions.

## Documentation

* [x] D01 Publish the English backend specification.

  Owner: coordinating Codex agent. Status: `done`. Acceptance: the function scope, confirmed decisions, proposed policies, and acceptance examples are published. Evidence: completion record 1.

* [x] D02 Publish the backend architecture.

  Owner: coordinating Codex agent. Status: `done`. Acceptance: module ownership, state progression, API catalog, AI contract, and recovery boundary are published. Evidence: completion record 1.

* [x] D03 Publish the readable backend function guide.

  Owner: coordinating Codex agent. Status: `done`. Acceptance: both backend documents have a readable explanation that preserves confirmed, proposed, optional, and deferred distinctions. Originally published in Chinese; the English replacement is tracked under D06. Evidence: completion record 2.

* [x] D04 Publish the shared checklist and agent update instructions.

  Owner: coordinating Codex agent. Status: `done`. Acceptance: agents can find the checklist, task IDs, ownership, acceptance criteria, and completion evidence rules from the repository root. Evidence: completion record 2.

* [x] D05 Publish the English agent board setup guide.

  Owner: Codex documentation agent. Status: `done`. Acceptance: teammates can configure a shared issue, authenticate separately, exchange a message, and understand agent waiting and shared branch coordination. Publish the guide on `main` and verify the remote commit. Evidence: completion record 3. No live board installation or message delivery is implied by document publication.

* [x] D06 Translate the remaining project documentation into English.

  Owner: Codex documentation agent. Status: `done`. Acceptance: all tracked project documents use English prose, the translated backend guide has an English filename, local links resolve, and the changes are verified on remote `main`. Preserve task IDs, completion history, and product requirements. Evidence: completion record 4.

* [x] D07 Publish the selected ElevenLabs and local agent architecture with the existing prototype source.

  Owner: Arjun Codex agent. Status: `done`. Evidence: completion record 5. Acceptance: preserve the confirmed multiplayer specification, document Route A and all eight logical roles, distinguish live models from downloaded candidates, publish the hosted API clients and tested prototype, and verify the work commit on `main`. This does not complete B01 through B13 or multiplayer integration tasks. Scope: documentation, agent instructions, existing `rehearsal/`, tests, clients, and the existing model lab source snapshot.

* [x] D08 Require a TODO update during every assigned agent work turn.

  Owner: coordinating Codex agent. Status: `done`. Acceptance: repository instructions require an update at work start and before completion or handoff, preserve unchecked partial tasks, and require verified remote publication before checking completed work. Progress: rules and the shared entry format are published to `Ricardo`. Checks: English prose, whitespace, task ID uniqueness, existing P02 state, and remote work commit verification passed. Next action: no further work for this documentation task; agents apply these instructions when working in the repository. Evidence: completion record 7.

* [x] D09 Review Jeff's pushed branch and record the collaboration boundary.

  Owner: coordinating Codex agent. Status: `done`. Acceptance: record the checked branch and commit, actual frontend work and placeholders, integration gaps, and the recommended nonoverlapping backend scope. Progress: source review and shared snapshot are published to `Ricardo`. Checks: remote branch and commit authors, source contents, integration call search, empty placeholder sizes, and remote publication were verified. Next action: use the recorded frontend and backend boundary; gameplay frontend ownership still needs assignment. Evidence: completion record 8.

* [ ] D10 Establish the shared GitHub issue board for Ricardo and Jeff's coding agents.

  Owner: Ricardo's Codex agent. Status: `waiting`. Acceptance: issue 6 exists, the connection request is published, and a local watcher automatically delivers peer comments to an exact existing Codex session using `codex queue --resume`, with deduplication and documented startup for each teammate. Keep local trigger verification distinct from a verified reply by Jeff's agent. Progress: the automatic watcher and guide are published on `main` in [039214a](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/039214a89e98b2eebe95cd1cfe99ff03c9651b2e). Ricardo's watcher is running, bound to the requested existing conversation, with 30 second incremental polling. Jeff's one time startup instructions are published in [the board notice](https://github.com/jeefwashere/BoardroomCrisisSimulator/issues/6#issuecomment-6712852230). Checks: 10 focused tests passed and an independent agent reran them successfully; stale state and linked worktree regressions are covered. Background start, duplicate exclusion, live polling, and graceful stop passed. An existing explanation session automatically replied `BOARD_TRIGGER_OK`, then `BOARD_WATCHER_TRIGGER_OK` after the actual delivery function sent explicitly synthetic data. The published work commit matched remote `main`. Local proof is in the ignored `.local/board-auto-trigger-verification.json`. Next action: Jeff starts his local watcher once, then verify an actual reply and automatic delivery between the two computers. No reply from Jeff's agent has been observed, so this task remains unchecked.

## Product and content

* [ ] P01 Record the remaining product choices.

  Owner: unassigned. Status: `available`. Acceptance: record the team's choices for speaking duration, total session duration, vote replacement and visibility, CEO absence, custom action limits and outcome mapping, and scoring. Preserve unsettled choices as proposed.

* [x] P02 Supply and validate one complete scenario package.

  Owner: coordinating Codex agent. Status: `done`. Acceptance: one background, role list, decision sequence, prepared choices, consequences, allowed custom outcomes, no decision outcome, and ending are available with a fixed version. The published material is an explicitly fictional English cybersecurity draft with static validation, not previously supplied team content or a human playtested game. Evidence: completion record 6.

## Backend

* [x] B01 Create the FastAPI application entry and development setup.

  Owner: Ricardo Codex agent. Status: `done`. Acceptance: documented local startup succeeds, a health endpoint responds, and API documentation loads. This task does not claim gameplay is implemented. Progress: the FastAPI entry, pinned isolated dependencies, health endpoint, interactive API documentation, room smoke command, and startup guide are published to Ricardo. Checks: 18 lobby tests, 21 existing prototype tests, the authored offline demo, pip dependency consistency, documented JSON models, and an actual single worker HTTP run with three independent member clients passed. Next action: no remaining work for B01; continue the separate roles and start capability under B02. Evidence: completion record 9.

* [x] B02 Implement room creation, code based joining, membership, and roles.

  Owner: Ricardo Codex agent. Status: `done`. Acceptance: start requires 3 connected members, room capacity is 30, host and CEO permissions are distinct, and a name alone cannot reclaim another seat. Supports F01. Progress: frontend supplied codes, individual registration, host controlled batch roles, initial briefing, polling presence, and late admission with next round eligibility are implemented. At least 3 members must meet the documented 30 second activity window. Checks: 51 backend tests passed across rooms, scenario admission, and Start; the real HTTP smoke used three initial member sessions plus a fourth late join, rejected CEO Start, replayed the accepted Start, and retained the original electorate. Next action: no further work for this admission unit; timed gameplay transitions remain under B04 and B08. Evidence: completion record 10. Prior publication: completion record 9 and capacity update f268958.

* [ ] B03 Implement versioned scenario loading and validation.

  Owner: Ricardo Codex agent. Status: `in_progress`. Acceptance: reject invalid references and invalid outcomes, pin the room's scenario version, and apply prepared consequences from data. Requires P02. Supports F02. Progress: version 2 is admitted at startup with capacity 30, immutable public briefing data and a digest covering JSON plus documents. Version 1 is preserved. References, outcomes, metrics, graph termination, timing, and document paths are validated. Checks: 12 scenario tests passed; version 2 static validation checked all 64 authored paths and confirmed unchanged decisions and outcomes from version 1. Next action: implement authored consequence execution in the authoritative game transition unit. This task remains unchecked because Start only initializes briefing. Published admission work: completion record 10.

* [ ] B04 Implement the authoritative room state and transitions.

  Owner: unassigned. Status: `available`. Acceptance: all room mutations use one room owner, duplicate commands cannot repeat consequences, stale phase commands are rejected, and different rooms stay isolated. Supports F01 through F09.

* [ ] B05 Implement HTTP commands and live room snapshots.

  Owner: unassigned. Status: `available`. Acceptance: authenticated clients receive the current phase, members, speaker, choices, deadlines, and allowed actions; snapshot versions never move a client backward. Requires B02 and B04. Supports F07.

* [ ] B06 Implement the 60 second equal weight vote.

  Owner: unassigned. Status: `available`. Acceptance: one ballot per eligible member, no duplicate votes from retries or extra tabs, cutoff checked by the server, deterministic tally, and selected change and visibility rules applied. Requires B03 through B05. Supports F04.

* [ ] B07 Implement CEO tie decisions and no decision outcomes.

  Owner: unassigned. Status: `available`. Acceptance: only the CEO chooses among tied leaders, zero votes follow the authored no decision outcome, and the selected CEO absence policy is explicit. Requires B06. Supports F05.

* [ ] B08 Implement sequential speaking and speaker deadlines.

  Owner: unassigned. Status: `available`. Acceptance: include the selected scenario's reading period and shared discussion budget, one active speaker at a time, selected duration and skip policy, protection against repeated or old timers, and voting after speaking. Requires B04 and B05. Supports F03. Audio transport is a separate optional feature.

* [ ] B09 Implement custom action proposals and frozen voting choices.

  Owner: unassigned. Status: `available`. Acceptance: only eligible members submit during the allowed phase, selected text and count limits apply, and proposal contents cannot change after voting starts. Requires B03, B04, and B06. Supports F06.

* [ ] B10 Implement the AI deciding operation for a selected custom action.

  Owner: unassigned. Status: `available`. Acceptance: validated provider output maps only to allowed outcomes, provider errors are visible, selected retry policy applies, and late or duplicate results cannot alter ended or newer rounds. Requires B09 and an agreed AI contract. Supports F06.

* [ ] B11 Implement automatic progression and session ending.

  Owner: unassigned. Status: `available`. Acceptance: one resolved decision advances exactly once, authored endings and total timeout work, selected deadline precedence applies, and post ending AI results cannot change gameplay. Requires B03, B04, B06, and B07. Supports F03 and F08.

* [ ] B12 Implement decision history, results, and final AI feedback.

  Owner: unassigned. Status: `available`. Acceptance: final records match committed decisions, unresolved actions are identified, and a factual summary remains available when AI feedback fails. Requires B10 and B11 for the full custom action flow. Supports F08.

* [ ] B13 Implement basic disconnect and rejoin.

  Owner: unassigned. Status: `available`. Acceptance: the same member returns to the same seat and existing vote while the meeting and clocks continue; refresh does not add a voter or replay a decision. Requires B02, B04, and B05. Supports F09. Server restart recovery is deferred.

## Game client and 3D assets

* [x] G01 Build the in game screens and a browser 3D boardroom with the ten rigged characters.

  Owner: Arjun's Claude agent. Status: `done`. Evidence: completion record 11. Branch: `arjun/game-ui-3d`. Progress: branch created from `main` at `b5d6fcb`. Scope: briefing, speaking turns, the 60 second vote, the CEO tie decision, results and debrief, plus a three.js boardroom with characters `01` to `10` seated and animated from their Mixamo rigs. Jeff's pre game pages on `website` are not changed. Gameplay endpoints are not implemented yet, so the screens use a mock adapter shaped to the documented room API. Progress: `game-ui/` contains the screens, a mock game that follows the MapleCart v2 timing, vote policy, outcomes and endings, an HTTP adapter for `GET /api/rooms/{id}`, and the boardroom with characters `01` to `10`. Hips translation from the Mixamo animation rig is converted to the character scale, and two bone arm IK rests the hands on the table at the user's request. Checks: `npm run build` passed; Playwright at 1440 by 880 played a full mock game with a forced CEO tie and zero vote rounds, and metrics matched the scenario deltas (55, 80, 60 after targeted containment); the HTTP adapter against a local backend with 3 started members plus a late browser seat showed the server briefing, roster and countdown; hands measured at the rest target on every character. Next action: connect gameplay screens to the backend once it serves speaking, voting and outcomes; that integration belongs to I01 and I02 and is not claimed here.

* [x] G02 Generate boardroom set and prop models with Nano Banana images and TRELLIS.2.

  Owner: Arjun's Claude agent. Status: `done`. Evidence: completion record 12. Progress: the user assigned Velocity job 20031 for this work. Its GPU also serves the hosted LFM3 API, so free GPU memory is checked before any TRELLIS.2 run. Progress: 8 Nano Banana 2.1 calls with no retries produced reference images; one TRELLIS.2 run on job 20031 (GPU `778d17bf` confirmed, 41.6 GB free beforehand, peak 17.4 GiB, LFM3 worker untouched) generated all 8 props; Blender scaled, decimated and retextured them to 5.9 MB total in `game-ui/public/models/props/` with `props.json`. Table and credenza were stretched to exact target sizes; the wall display model is unused in favour of the live screen. Checks: a rendered lineup of all 8 props was reviewed, and the props load and place correctly in the browser room. Next action: none; job 20031 can be reassigned.

## Integration and verification

* [ ] I01 Publish the frontend API and snapshot contract with examples.

  Owner: Ricardo Codex agent. Status: `in_progress`. Acceptance: examples match the implemented OpenAPI contract, the frontend can create, join, start, vote, resolve a tie, observe, and read results. No frontend implementation is implied by documentation alone. Progress: room-api.md and start-api.md document the frontend generated code, registered identities, batch Start JSON, role and activity rules, late admission, errors, and public briefing. Checks: documented JSON models, local links, English prose, typography, OpenAPI 422 variants, 51 backend tests, and actual HTTP Start and late join passed. Next action: extend the contract with timed rounds and voting when implemented. This task stays unchecked; no frontend source or deployed integration was changed. Published partial contract: completion record 10.

* [ ] I02 Verify one complete multiplayer game.

  Owner: unassigned. Status: `available`. Acceptance: at least 3 actual client sessions complete join, roles, speaking, vote, consequence, next round, and final feedback. Include one custom winner and one rejoin. Record commands and observed results.

* [ ] I03 Verify concurrency and failure boundaries.

  Owner: unassigned. Status: `available`. Acceptance: check the specification's acceptance cases, including 30 simultaneous voters, duplicate commands, cutoff equality, stale timers, CEO absence, provider failure, late AI, zero votes, and room isolation. Passing local unit tests alone does not prove the live client flow.

* [ ] I04 Verify the selected deployment and frontend connection.

  Owner: unassigned. Status: `available`. Acceptance: record the host and commit, verify HTTP plus WebSocket access from the frontend, and document the actual process and persistence boundary. The proposed memory design uses one worker and does not survive a backend restart.

## Optional and deferred

* [ ] O01 Generate three reviewed scenario documents after topics and format are chosen.

  Owner: unassigned. Status: `optional`. Acceptance: the team chooses the topics, generated content passes scenario validation, and approved versions are available before play. Supports optional F10.

* [ ] O02 Add selected communication or media features.

  Owner: unassigned. Status: `optional`. Acceptance: first record which media capability is selected, then verify its actual client flow. Timed speaking alone does not complete this task. Supports optional F11.

* [ ] O03 Add durable recovery and coordinated multiple workers.

  Owner: unassigned. Status: `deferred`. Acceptance: persist state and command receipts, recover timers and AI jobs, and verify exclusive room mutation plus shared broadcasts. Database installation alone does not complete this task. Supports deferred F12.

## Completion records

1. D01 and D02. Owner: coordinating Codex agent. Work commit: [134661e](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/134661e7c8f77fa0be060c13987285022abb2686). Branch: `Ricardo`. Merged through [PR 1](https://github.com/jeefwashere/BoardroomCrisisSimulator/pull/1) into `main` at `86b94184226a6275023b2ce7feba4637de7d5627`. Verification: `git merge-base --is-ancestor 134661e7c8f77fa0be060c13987285022abb2686 origin/main` and `git diff --exit-code origin/main -- docs/backend-spec.md docs/backend-architecture.md` passed after fetch. This proves document publication, not backend functionality.

2. D03 and D04. Owner: coordinating Codex agent. Work commit: [318d14c](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/318d14c6171af0c9870ae5601c6fcfd374c6ea16). Branch: `Ricardo`. Verification: `git ls-remote --heads origin Ricardo` returned the same full commit as `git rev-parse HEAD` after a successful push. `git diff --cached --check` passed before that commit. The GitHub Markdown API rendered all 26 checkboxes, and local link and typography checks passed. Merge status at this completion record: pushed feature branch; the accompanying pull request records the final merge status. No implementation task was marked complete.

3. D05. Owner: Codex documentation agent. Work commit: [88ecac4](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/88ecac4a54c91c782ec39005d1f874387d217e83). Remote branch: `main`. Verification: after a successful push, `git ls-remote --heads origin main` returned `88ecac4a54c91c782ec39005d1f874387d217e83`, matching `git rev-parse HEAD`. Local link, English prose, typography, and Bash syntax checks passed for all seven Bash examples. GitHub's Markdown API rendered ten headings and ten code blocks. `git diff --cached --check` passed. Publication status: directly published on `main`. These checks verify the guide, not a live board installation or agent message exchange.

4. D06. Owner: Codex documentation agent. Work commit: [cef3091](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/cef30910ad2a0a6644d6e4a81a712ac84386c956). Remote branch: `main`. Verification: after a successful push, `git ls-remote --heads origin main` returned `cef30910ad2a0a6644d6e4a81a712ac84386c956`, matching `git rev-parse HEAD`. A Unicode scan found no Chinese characters in the eight current project files. Local link and prose typography checks passed, all 27 existing task states were preserved, and GitHub's Markdown API rendered the translated guide and checklist successfully. Publication status: directly published on `main`. Product scope and application implementation status remain unchanged.

5. D07. Owner: Arjun Codex agent. Work commit: [d728cb6](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/d728cb61afebc42f56bac1f636baa690a35aa4e5). Remote branch: `main`. After a successful push, `git ls-remote --heads origin main` returned `d728cb61afebc42f56bac1f636baa690a35aa4e5`, matching the local work commit. The latest English translation and all previous completion records were preserved. Verification: 21 tests passed with `python3 -m unittest discover -s tests -v`; `python3 -m rehearsal demo` passed with three participants; TypeScript checking, site production build, Markdown link checks, task ID uniqueness, credential scanning, and `git diff --cached --check` passed. Sites version 2 was deployed successfully from site source commit `2d0a9e625ff1309894bd5dc0fc16fcf41e941f13`. Both hosted Markdown files returned HTTP 200 and matched their source bytes, and `/api/status` reported the model worker online. Publication: directly on `main` and at [the team model lab](https://rehearsal-gpu-lab-team22.arjunb3hl.chatgpt.site). Browser visual QA remained unavailable. This verifies documentation publication and the existing prototype source; it does not complete multiplayer, paid speech, or live microphone acceptance tasks.

6. P02. Owner: coordinating Codex agent. Work commit: [f20de37](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/f20de3781e373c707523215c1922413c83bf1050). Branch: `Ricardo`, verified through `git ls-remote --heads origin Ricardo` after push. Verification: `python3 -m json.tool scenarios/cybersecurity_demo/v1/scenario.json --no-ensure-ascii` passed; the local validator at `/Users/gz/work/boardroom-architecture/validate-cyber-scenario.py` also passed all 64 prepared and no decision paths, references, meter bounds, evidence carryover, English content, document links, and timing arithmetic. Published results: `scenarios/cybersecurity_demo/v1/validation.json`. The draft is about 18 minutes, or 19.5 minutes with three CEO ties; a 15 minute profile is included. Merge status at this record: pushed feature branch. While incorporating the latest `main`, `python3 -m unittest discover -s tests -v` passed 21 existing tests and `python3 -m rehearsal demo --output /Users/gz/work/boardroom-architecture/scenario-merge-demo.json` passed in authored offline mode. These additional checks verify the existing prototype, not integration of this new scenario. Application schema compatibility, AI quality, backend execution of this package, multiplayer behavior, and human timing remain unverified. B03 and all other backend tasks stay unchecked.

For new completions, append task ID, owner, remote branch, work commit or PR link, verification command and result, plus merge status if known. Leave incomplete tasks unchecked.

7. D08. Owner: coordinating Codex agent. Work commit: [6dab711](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/6dab7114dacd524ba555cef81aa6c825e4a7680f). Branch: `Ricardo`. After a successful push, `git ls-remote --heads origin Ricardo` matched `git rev-parse HEAD` at the full work commit. Verification: `git diff --cached --check` passed for the work commit; English prose, whitespace, technical path exceptions, all 30 unique task IDs, and the existing checked P02 state were checked. Merge status at this record: pushed feature branch. The change strengthens agent instructions and checklist maintenance; application behavior is unchanged.

8. D09. Owner: coordinating Codex agent. Work commit: [0c9a496](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/0c9a496fd1adda7033963d3391c1dbaecda1aa6e). Branch: `Ricardo`. `git ls-remote --heads origin Ricardo` matched `git rev-parse HEAD` after push. Source review checked Jeff Tieng's `website` commit `85046a41a79b68a2f6f33572e87c61abc5a10631`, still the latest remote commit at publication. `git cat-file -s` confirmed the four named placeholders are empty, and the source search found no application API or WebSocket integration. All preexisting task checkbox states were preserved. This is a static collaboration review; no frontend build or browser test was run, and Jeff's branch was not changed.

9. B01 complete; B02 and I01 partial. Owner: Ricardo Codex agent. Work commit: [7cb8c92](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/7cb8c92f203bd18b8ba9ffd13ca76277d6966e43). Remote branch: `Ricardo`. After successful push, `git ls-remote --heads origin Ricardo` matched `git rev-parse HEAD` at the full work commit. Verification: `backend/.venv/bin/python -m unittest discover -s backend/tests -v` passed 18 tests; `python3 -m unittest discover -s tests -v` passed 21 existing tests; `python3 -m rehearsal demo --output artifacts/room-module-prototype-demo.json` passed in authored offline mode. `backend/.venv/bin/python -m pip check`, documented JSON model validation, and `git diff --cached --check` passed. The documented single worker Uvicorn startup succeeded; `backend/.venv/bin/python -m backend.smoke` passed using three independent member HTTP clients plus an unrelated session, including health, docs, OpenAPI, duplicate join, and access rejection. The owned test server was stopped afterward. Publication status at this record: pushed feature branch, merge status recorded in the accompanying PR. Only the initial lobby capability is implemented. Roles, start, game flow, live presence, WebSocket delivery, deployed frontend integration, durable recovery, and full multiplayer acceptance remain open. No frontend source, existing rehearsal code, model service, or paid provider was changed or invoked.

10. B02 complete; B03 and I01 partial. Owner: Ricardo Codex agent. Work commit: [fc23c1f](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/fc23c1f8dc9921725c6a108b4387fb4b843aee76). Remote branch: `Ricardo`. After integrating the current main, `git ls-remote --heads origin Ricardo` matched `git rev-parse HEAD` at `c3267b104e9c75ca6d999639bf141656370944d5`, and `git merge-base --is-ancestor fc23c1f HEAD` passed. Verification: `backend/.venv/bin/python -m unittest discover -s backend/tests -v` passed 51 tests; `python3 -m unittest discover -s tests -v` passed 31 prototype and board watcher tests. The independent Start suite passed 21 tests, including simultaneous code collision, Start versus join, failed activity updates, permissions, roster rejection, exact activity cutoff, capacity 30, retries, and late eligibility. `python3 -m rehearsal demo --output artifacts/start-module-prototype-demo.json` passed in authored offline mode. The owned Uvicorn process and `backend/.venv/bin/python -m backend.smoke` passed actual HTTP initialization, three member Start, a fourth late admission, unchanged first electorate, CEO rejection, and replay; the process was stopped afterward. Version 2 static validation checked all 64 authored paths and startup catalog admission; version 1 remained unchanged. Documented JSON models, links, English prose, typography, dependency consistency, and whitespace checks passed. Publication status at this record: pushed feature branch, final merge status recorded in the accompanying PR. Presence means authenticated room activity within 30 seconds, not immediate socket detection. Briefing initialization and next round eligibility metadata are implemented; timers, later rounds, actual voting participation, authored consequence execution, AI, WebSocket delivery, and deployed frontend integration remain open. Jeff's frontend, the existing model service, and its paid providers were not changed or invoked.

11. G01. Owner: Arjun's Claude agent. Work commits: [421443b](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/421443b) and [3c1411a](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/3c1411a87294d3c335d1877c5dc18285a503b62b). Remote branch: `arjun/game-ui-3d`; `git ls-remote --heads origin arjun/game-ui-3d` matched `git rev-parse HEAD` at `3c1411a87294d3c335d1877c5dc18285a503b62b` after push. Verification: `npm run build` in `game-ui` passed. Playwright in Chromium at 1440 by 880 played a full mock game through briefing, reading, speaking turns, voting, a forced CEO tie, two zero vote rounds and the debrief; metrics matched the scenario deltas. The HTTP adapter against a locally started backend with 3 started members and a late browser seat rendered the server briefing, roster and countdown; the owned backend process was stopped afterward. Hand IK placed every character's hands at the tabletop rest target. `python3 -m unittest discover -s tests` passed 31 tests and `backend/.venv/bin/python -m unittest discover -s backend/tests` passed 51 tests; neither suite covers `game-ui`. Merge status at this record: pushed feature branch, not merged. Gameplay beyond the briefing runs only in the mock; backend speaking, voting, outcomes, mobile layouts and characters 11 to 30 remain open.

12. G02. Owner: Arjun's Claude agent. Work commit: [3c1411a](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/3c1411a87294d3c335d1877c5dc18285a503b62b). Remote branch: `arjun/game-ui-3d`, verified with the same `git ls-remote` check. Verification: 8 Nano Banana 2.1 calls with no retries; one TRELLIS.2 run on job 20031 after confirming GPU `778d17bf` and 41.6 GB free, exit 0, peak 17.4 GiB; a rendered lineup of all 8 optimized props was reviewed, and the props load in the browser room. Merge status at this record: pushed feature branch, not merged. Known flaws: a faint baked reflection on the unused display model, a faint dark strip under the credenza, and small shards at the plant base.
