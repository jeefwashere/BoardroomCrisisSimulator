# Shared TODO

This is the shared task list for project agents. A checked implementation task means its acceptance criteria passed and its work commit is on the recorded remote branch. It does not necessarily mean the branch has merged. Each agent updates its own task and completion record, then pushes the checklist change. Follow `AGENTS.md` for the exact update order.

Status values: `available`, `in_progress`, `waiting`, `done`, `optional`, `deferred`. Fill in the owner when taking an assigned task. Proposed behavior remains selectable until the team confirms it.

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

## Product and content

* [ ] P01 Record the remaining product choices.

  Owner: unassigned. Status: `available`. Acceptance: record the team's choices for speaking duration, total session duration, vote replacement and visibility, CEO absence, custom action limits and outcome mapping, and scoring. Preserve unsettled choices as proposed.

* [x] P02 Supply and validate one complete scenario package.

  Owner: coordinating Codex agent. Status: `done`. Acceptance: one background, role list, decision sequence, prepared choices, consequences, allowed custom outcomes, no decision outcome, and ending are available with a fixed version. The published material is an explicitly fictional English cybersecurity draft with static validation, not previously supplied team content or a human playtested game. Evidence: completion record 6.

## Backend

* [ ] B01 Create the FastAPI application entry and development setup.

  Owner: unassigned. Status: `available`. Acceptance: documented local startup succeeds, a health endpoint responds, and API documentation loads. This task does not claim gameplay is implemented.

* [ ] B02 Implement room creation, code based joining, membership, and roles.

  Owner: unassigned. Status: `available`. Acceptance: start requires 3 connected members, room capacity is 20, host and CEO permissions are distinct, and a name alone cannot reclaim another seat. Supports F01.

* [ ] B03 Implement versioned scenario loading and validation.

  Owner: unassigned. Status: `available`. Acceptance: reject invalid references and invalid outcomes, pin the room's scenario version, and apply prepared consequences from data. Requires P02. Supports F02.

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

## Integration and verification

* [ ] I01 Publish the frontend API and snapshot contract with examples.

  Owner: unassigned. Status: `available`. Acceptance: examples match the implemented OpenAPI contract, the frontend can create, join, start, vote, resolve a tie, observe, and read results. No frontend implementation is implied by documentation alone.

* [ ] I02 Verify one complete multiplayer game.

  Owner: unassigned. Status: `available`. Acceptance: at least 3 actual client sessions complete join, roles, speaking, vote, consequence, next round, and final feedback. Include one custom winner and one rejoin. Record commands and observed results.

* [ ] I03 Verify concurrency and failure boundaries.

  Owner: unassigned. Status: `available`. Acceptance: check the specification's acceptance cases, including 20 simultaneous voters, duplicate commands, cutoff equality, stale timers, CEO absence, provider failure, late AI, zero votes, and room isolation. Passing local unit tests alone does not prove the live client flow.

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
