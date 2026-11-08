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

6. The latest user test uses `/meeting`: three explicitly labelled test memberships in one window, a 90 second scripted mechanics demo, real local agent replies and simultaneous post round review. This supersedes the separate window preference for this mode only. See [the measured evaluation](playtest/MEETING_REPORT.md). Preserve the distinction between scripted seats, model replies and enforced authored evidence.

## Approved Vertex experiment

The user explicitly approved Gemini 3.8 Flash with LOW reasoning for every text responsibility in `playtest/`, replacing its local model API calls. This supersedes the local provider direction above for this experiment only. Retain ElevenLabs Scribe v2 and Flash v2.5, the persistent shared 10,000 credit speech cap, and server authority. Vertex has a separately confirmed US$2 test reservation cap; keep its SQLite ledger across restarts. Do not delete GPU weights, stop shared workers, or alter teammate production modules. Historical local results remain in `playtest/MEETING_REPORT.md`. Read `playtest/PROGRESS.md` for current status and never treat a smoke probe as a completed evaluation.

## Prerecorded audio testing

The user requested parallel subagent work and reusable ElevenLabs recordings for conversation and turn tests. `playtest/recordings/` contains 36 fixed fictional MP3 assets generated at concurrency two, with a caption catalog and integrity manifest. Read `playtest/AUDIO_TEST_GUIDE.md` and `playtest/AUDIO_REPORT.md`. The `/audio-lab` recorded demo makes no new model or transcription calls; manual live calls are separately labelled. Keep recorded fixtures distinct from live Gemini replies and real human speech. Never regenerate files for playback or bypass the existing shared speech and Vertex ledgers. Only source text is committed by the free scripted demo; testing recognition requires an explicit transcription request and separate reviewed contribution.

## Updated spending authorization

During X09 the user explicitly raised total caps to 30,000 ElevenLabs credits and US$20 Vertex. This supersedes the older 10,000 credit and US$2 limits above. Retain all existing reservations and caches. Apply a ceiling increase only through an explicit operator authorization, never by deleting a ledger or changing data directories. Ordinary restarts cannot enlarge a stored cap. Provider billing plans and credit purchases are outside this local cap update.

## CEO meeting and PDF preparation experiment

The user selected the existing CEO role and written discussion records with explicit microphone transcription. The isolated `/roundtable` mode uses `playtest/roundtable.py` for authority and `playtest/roundtable_api.py` for room scoped advisory jobs. It has a ready gated lobby, optional 60 second opening and closing facilitator windows, three minute discussion and an untimed decision phase. Preserve explicit human proposals, ballots and CEO result commitment. This separate prototype freezes its roster at Start; production late admission requirements remain unchanged.

`google/embeddinggemma-2` supplies actual local text embeddings for the PDF preparation memory. Gemini Flash LOW still supplies text selection; there is no local conversation API fallback. Read `playtest/PDF_MEMORY.md` and `playtest/ROUNDTABLE_GUIDE.md`. Only public participant packs may seed demo PDFs. Never index the hidden controller reference, review answers, environment files or credentials. Pass the room's selected document IDs for every search and download. Model weights, uploaded PDFs and index caches stay ignored on disk. Never send all uploaded documents to a room.

Minutes select exact transcript quotes and suggest problems for human review. They cannot establish facts, cast votes, assign roles or mutate decisions. One automatic minutes job on entry to decision is labelled in the UI; retain the shared paid reservation ledgers. Recording and transcription are explicit and provisional until a separate contribution command. No continuous microphone capture is authorized for this mode. Test role gates, isolation, stale replies and idempotency before publication.

## Current manual meeting and live agents

X11 supersedes the earlier experimental flow. `/` and `/roundtable` automatically attach one T01 PDF. A button loads and readies three test members. CEO Start triggers a roughly 30 second live preparation introduction, then a five minute discussion with server enforced participant turns. The CEO can finish early and consult the live facilitator, IT adviser or journalist. A live decision guide prompts the board; explicit votes and CEO confirmation commit a result, then a live evaluation interprets that actual result.

The latest user clarification requires manual controls beneath each participant and a clear current turn indicator. Do not autoplay participant recordings. Expose only the three saved participant clips; reject all prerecorded AI agent clips and other participants' assigned recordings. Playback completion and the trusted caption commit are separate explicit actions. Agent speech always comes from Gemini plus ElevenLabs, grounded in the PDF, discussion and actual decision. The removed `/audio-lab` and `/audio-guide` pages must not return to navigation or routing.

The user explicitly removed all app credit and spending constraints. Both ledgers have persisted unlimited authorization; preserve usage rows and do not reintroduce the earlier US$20 or 30,000 credit caps. `--unlimited-budget` is the authorized operator flag. Do not delete ledgers or expose provider credentials. Request sizes, queue bounds, response length and microphone duration remain resource controls rather than financial gates.

Gemini streams text through the backend; completed sentences stream as ElevenLabs PCM. Stop, phase and turn changes cancel output. Automatic decision and evaluation events are deduplicated in both client and backend. The generated briefing is advisory, replacing exact quote only preparation for this mode; minutes still select transcript quotes. Models cannot submit human contributions, vote, assign roles, start meetings or rewrite committed results. Read `playtest/ROUNDTABLE_GUIDE.md` and `playtest/STREAMING_PREPARATION.md` for current controls and measured limits.


## Current guided decision round

X12 restores a visible 60 second consultation phase between participant discussion and decisions. The CEO can end discussion early or skip the consultation minute. Preparation, facilitator, IT, journalist and evaluation remain live Gemini plus ElevenLabs. The user explicitly requested one exception: a prerecorded decision guide reads the fixed choices after consultation. Keep it clearly labelled as recorded and separate from human contributions, ballots and live adviser replies.

For the default exact T01 PDF selection, the server creates one authored ballot with Controlled continuity, Technical checks first and Wait for the director. Every participant explicitly chooses an option. The CEO commits the winning option after every ballot, or selects among tied leaders. Do not fabricate votes, silently change a selected choice or let a model override the result. Other document selections retain the custom proposal flow. The fixed choices are potential board actions based on the public pack, not hidden event outcomes.

The three new manual participant recordings are T01 leadership, recovery checks and communications. Their exact captions become contributions only after explicit completion and commit. The decision guide has its own authenticated read only playback route and cannot be submitted as a participant recording. Keep replay free of provider calls, preserve all usage ledger rows and retain unlimited app spending authorization. See `playtest/GUIDED_ROUND_REPORT.md` for the current check and `playtest/ROUNDTABLE_GUIDE.md` for controls.


## Individual UI voting

X14 makes the fixed T01 voting UI ask each eligible member by name. First ballots follow the server electorate order; no unvoted member may skip ahead, and no absent member receives an automatic ballot. Selecting a response is a local draft until Confirm my vote. Revisions remain explicit until CEO commitment. Advance between identities automatically only for the authorized single window test bundle, never for independent participant browsers. Preserve the all ballots required result lock and reject stale UI confirmation against a different selected identity.


## Extended conversation and custom choices

X16 supersedes the earlier three clip limit and prepared choices only guidance for the T01 playtest. Nine distinct participant recordings follow turn numbers one through nine, three per test participant. Playback remains manual and a separate trusted caption commit passes the turn. Do not loop the clips after turn nine; typed discussion can continue. The revised recorded decision guide explains prepared and custom choices. Live advisers and evaluation remain Gemini plus ElevenLabs.

Eligible members can add up to three custom responses beside the three prepared choices before commitment. Adding a choice clears pending votes and increments the ballot revision; require explicit acknowledgement when votes exist. Reject stale ballots and stale CEO commitment. Every member must explicitly vote again. The winning custom proposal becomes the canonical decision text; the CEO may select only among tied leaders. Models cannot override this result or treat custom proposal text as verified evidence or instructions. See [the extended conversation report](playtest/EXTENDED_CONVERSATION_REPORT.md).


## CEO custom proposal and voting audio

X17 supersedes X16 permission for any member to add a custom response. Only the selected CEO can add it, through both the UI and server. Other members retain their individual votes. The new `t01_ceo_voting_guide` recording explains CEO custom proposals, explicit confirmation, reset after a new option, and CEO confirmation of the winner or selection among tied leaders. The CEO cannot override a clear winner. Existing nine participant turns and unlimited usage ledgers remain unchanged. Read [the update](playtest/VOTING_AUDIO_UPDATE.md).


## Four round design and individual Round 1

X18 implements only the group first round of [the user design](playtest/FOUR_ROUND_DESIGN.md). New browser rooms use `flow: board_round1`; preserve `legacy` rooms for the earlier ballot experiment. Keep the 30 second preparation agent. Group discussion precedes three live expert perspectives: IT/security, operations/community services and governance/finance. All three completed perspectives are required before individual decisions. A failed request cannot silently satisfy this gate.

Each member submits their own action, reasoning, evidence and unknowns, with explicit review. No shared winning ballot, CEO override, points or group evaluation occurs in this mode. The CEO closes Round 1 only after all members submit. Snapshots and authenticated preparation exports expose only the caller's individual decision, alongside shared discussion and expert advice. Models cannot submit or edit human decisions. Private rounds, twists, scores and reunion remain deferred. Preserve the old assets and unlimited usage ledgers. Read [current verification](playtest/ROUND_ONE_REPORT.md).


## Working four round beta

X19 supersedes the X18 deferred private rounds boundary for new `flow: four_rounds` rooms. Read [the current workflow](playtest/FOUR_ROUND_WORKFLOW.md) and [test guide](playtest/ROUNDTABLE_GUIDE.md). Retain the opening preparation and all three Round 1 experts. The included T01 beta requires exactly three members; old `board_round1` and `legacy` flows remain available for regression work.

Each member has one private agent identity across coaching and assessment. Scope context and fixture leases to the authenticated member. No Round 2 points. Only confirmed Round 3 answers earn the 30/40/30 rubric points, with exact supporting quotes and server computed totals. Preserve the all members finished reunion gate. Corrections use existing Round 3 text only; new reflection text cannot earn points. Winner announcement requires every member's review and a current summary. Highest final score wins, with joint winners on ties.

Beta mode defaults on and can change only through the CEO in the lobby. Canonical questions match the stage assigned human recordings. Gemini acknowledgements, cards and scoring remain live at temperature zero, with no promise of identical outputs. Adaptive questions use temperature 0.3. Do not replace agent output with prerecorded speech, auto submit a human answer, or infer performance from playback.

The current exercise has 36 human clips including 27 added for individual decisions and Rounds 2 through 4. Preserve existing assets and usage ledgers. Playback, review and submission remain separate. Private structured output is validated before ElevenLabs PCM streaming; do not claim it streams Gemini tokens before validation. The local prototype has no durable room store or synchronized browser conference audio. Keep these limits distinct from passing HTTP checks.


## Single guided decision answer

X20 replaces the four visible Round 1 fields with one guided answer box. Preserve explicit confirmation, member draft isolation and reviewed recorded or microphone input. The existing API stores the complete response verbatim in action and labels other fields as not separately extracted; do not infer separate reasons or evidence. Keep existing live rooms intact when updating static UI files. Read [the update](playtest/SINGLE_ANSWER_UPDATE.md).
