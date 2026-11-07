# Backend specification

Status: design proposal for team selection. Application implementation has not started.

## 1. 中文摘要

已确认：多人危机模拟，房间码加昵称加入，开始时至少 3 人，最多 20 人，不同角色但不提供角色私密信息。玩家按顺序发言，然后进行 60 秒等权投票。平票由 CEO 决定，完成决策后自动推进。已有预设答案和后果，也支持自定义行动，由 AI 评估。AI 在结束时提供反馈。总时间到达或者决策流程完成时结束。玩家断线后可以回来，会议继续。

建议架构：一个 FastAPI 服务维护每个房间的权威状态，通过 HTTP 接受操作，通过 WebSocket 同步画面。剧本、选项和预设后果使用有版本的场景数据。AI 评估获胜的自定义行动，并返回允许范围内的结果。普通刷新和断线重连纳入基础功能，数据库恢复和服务器重启恢复作为后续可选范围。

尚未确认的数值和规则都标为 Proposed，包括发言时长、总游戏时长、角色分配方式、改票、票数可见性、CEO 缺席处理、评分细则和 AI 服务商。团队可以从本文的功能清单中选择交付范围。

## 2. Evidence and decision status

Confirmed means selected in the user's latest discussion. Proposed means an architect recommendation that remains editable. Deferred means explicitly left for later. The final correction in the discussion is used when speech recognition includes both an initial no and a later yes.

1. Confirmed: FastAPI is the intended backend for a shared AI crisis simulation.
2. Confirmed: rooms have multiple human players. Start requires at least 3 players. Capacity is 20.
3. Confirmed: join using a room code and a chosen display name.
4. Confirmed: different roles, with no private scenario information requirement.
5. Confirmed: predefined choices and consequences, plus custom actions. Custom actions were accepted after the discussion of an AI deciding agent.
6. Confirmed: equal vote weights, 60 seconds of voting, and CEO selection when the result is tied.
7. Confirmed: sequential speaking time for each person, followed by voting and automatic decision progression.
8. Confirmed: AI evaluates player decisions and provides final feedback.
9. Confirmed: the session ends at its total time limit or when its decision sequence finishes.
10. Confirmed: an existing player can rejoin while the meeting continues.
11. Deferred: advanced database recovery and server restart recovery.
12. Provisional: AI can prepare three scenario documents. Cybersecurity was mentioned as an example. The other topics and document structure are not confirmed. Three documents must not silently become three implemented game modes.

At the initial design review, remote `main` contained only the initial README and `.gitignore`. Existing story scripts had not been located in the repository. This specification defines their required shape without inventing their contents.

## 3. Frontend usage and complete game flow

1. The host selects an available scenario version, creates a room, and receives a room code and a host seat.
2. Players enter that code and a display name. The backend assigns a stable member identity. The frontend opens the room event connection and renders the returned snapshot.
3. The host assigns roles in the lobby. Proposed: exactly one CEO must exist before start. The host and CEO are separate permissions, even if one person holds both.
4. Starting validates the scenario, CEO, settings, and 3 to 20 connected members. The scenario version and initial roster are fixed for this session.
5. Each round presents the current situation and public materials. The backend announces one speaker at a time and the speaker deadline.
6. Players can submit a custom action during speaking. Prepared choices remain available. Proposed: one editable custom proposal per player, with a maximum of 1,000 characters. At most 20 custom proposals therefore enter a round.
7. When speaking finishes, the backend freezes the choices and opens a 60 second vote.
8. At the deadline, the backend resolves the most voted option, or requests a CEO decision among the tied leaders.
9. A prepared winner applies its authored consequence. A custom winner goes to the AI deciding operation, which evaluates it against the scenario and maps it to an allowed authored outcome.
10. The result, metric changes, and decision record are broadcast. Proposed: display the result for 5 seconds, then automatically start the next round if the scenario continues and session time remains. No mandatory host next round click is introduced.
11. At completion or total timeout, gameplay freezes. The final page shows the actual decision history and an AI evaluation. A structured factual summary is available even if AI feedback fails.

## 4. Scenario package

Proposed: scenario generation happens before a game starts. Each room pins a validated, immutable scenario version. Generation during a live vote must not change the choices already presented.

Every scenario package supplies:

1. `scenario_id`, `version`, title, description, and public background documents.
2. Role definitions, including the CEO role. Roles provide perspective or responsibilities without private scenario facts.
3. Initial metrics, allowed metric bounds, and metric meanings. The actual metric names belong to the supplied scenario.
4. An initial node and a finite set of decision nodes.
5. For each node: the situation, prepared options, allowed outcomes, custom action rubric, and optional terminal outcome.
6. For each prepared option: stable option ID, displayed action, and an authored outcome ID.
7. For each outcome: narration facts, exact metric deltas, and either a next node ID or a terminal ending.
8. An explicit path for no decision, so a round with zero votes has a defined meaning rather than fabricated agreement.
9. An evaluation rubric and any pass or fail criteria. Numerical grading is not an established requirement until this rubric exists.

Validate IDs, references, reachable endings, metric bounds, and at least one prepared choice per decision node before exposing a package for play. Proposed: the initial package format uses JSON plus Markdown background documents. An editor UI is optional.

An AI drafted package remains a draft until these checks pass and the team accepts its content. The document generation feature is separate from runtime decision evaluation.

## 5. Rooms, roles, and identity

Proposed defaults:

1. The host chooses display settings and roles before start. A room code locates a room; the display name does not prove ownership of an existing seat.
2. Creating or joining establishes a server issued membership credential. Rejoin uses that credential, not another entry of the same nickname.
3. Use a same origin deployment with a membership cookie for HTTP and WebSocket authentication. Validate membership for every operation and WebSocket connection. The frontend receives only its own seat and permissions.
4. New seats may join only in the lobby. Existing seats can reconnect in any phase, including after the room drops below three connected players.
5. Start requires three connected players, but the meeting does not automatically stop when someone disconnects afterward.
6. Role changes are locked after start, apart from an explicitly recorded CEO reassignment when the CEO is absent during a tie.
7. A second connection for the same member does not create a second voter. Presence means at least one authenticated connection remains live.

Host actions are room configuration, role assignment, start, and an explicit end action. CEO authority applies to a tied result. Neither role can silently replace a normal winning vote.

## 6. Speaking

Confirmed: each player has a speaking turn and turns happen sequentially.

Proposed defaults:

1. Use stable lobby seat order. Each round freezes its speaker order.
2. Allow 30 seconds per player. The active speaker may finish early. The host may skip a speaker, and the reason is recorded.
3. Skip a member who is disconnected when their slot begins. A disconnect during a slot ends that slot. A reconnect does not rewind turns.
4. A returning player remains eligible to vote in the current round if they were in its original roster.
5. The server owns the speaker deadline; the frontend countdown is a display.

Speaking time is a turn permission and timer requirement. In app microphone transport, recording, transcription, and voice generation were not selected. Their implementation is an optional feature, not an implied WebSocket capability.

At 20 players, 30 seconds each consumes 10 minutes before a vote. The lobby should show the estimated minimum duration for the configured roster and scenario. The exact speaker and total session durations remain team choices.

## 7. Voting and ties

Confirmed: voting lasts 60 seconds and every eligible player has equal weight. The CEO decides a tie.

Proposed exact policy:

1. Freeze the eligible member IDs and valid option IDs when the round begins. Freeze the final option content when voting opens.
2. Each member has one current vote. They may replace it before the deadline. A new selection replaces their earlier vote rather than adding another vote.
3. Keep individual selections and aggregate counts hidden until close. This is voting secrecy, not private role information.
4. Keep the full 60 second period even if everyone has voted. Early close is a separately selectable feature.
5. The server accepts a vote only while `now < vote_deadline`. Requests processed at or after the deadline are rejected, even if sent earlier by the browser.
6. Missing votes are abstentions. A disconnected member's already accepted vote still counts. There is no extra quorum requirement beyond a game having started validly.
7. One leader by vote count wins. Multiple leaders with equal positive counts enter `tie_break`. Do not introduce a compulsory runoff.
8. The CEO chooses only among the tied option IDs. The CEO's ordinary vote still has the same weight as everyone else's.
9. Proposed: allow 30 seconds for the CEO decision. If the CEO is disconnected, the connected host may explicitly reassign the CEO role to a connected player within that period. The action is broadcast. If no valid CEO choice arrives, use the scenario's no decision outcome.
10. Zero votes uses the authored no decision outcome directly. It is not treated as a tie between every available option.

These rules, especially vote replacement, visibility, CEO absence, and abstention handling, remain proposals for team selection.

## 8. Custom actions and AI

The deciding agent is a bounded backend operation, not an independent process with direct access to room state.

1. Collect custom proposals during speaking. Validate author membership, phase, length, and proposal limit on the server. Freeze the text before voting begins.
2. Keep prepared and custom options distinguishable in the public contract. A custom option has no authored consequence until it has been evaluated.
3. Proposed: evaluate only the winning custom action. This avoids one AI call for every submitted idea. Prepared actions use their predefined consequence and can receive an explanation in the final debrief.
4. Input includes the pinned scenario version, current node, current metrics, selected text, relevant decision history, and authored rubric.
5. Proposed output: `outcome_id`, rubric assessments, explanation, and narrative text. The chosen outcome must belong to the current node's allowed outcome set.
6. The backend applies the metric deltas and next node belonging to that outcome. AI cannot write arbitrary metrics, invent a next node, alter votes, assign roles, or modify session deadlines.
7. Validate the output structure and domain references. Typed model validation is available through [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/), while checking that an outcome belongs to a particular scenario remains application logic.
8. Proposed: one 15 second attempt, then a visible `resolution_failed` state. The host can request one further attempt. The total session clock continues.
9. If output is invalid or unavailable, preserve the voted action as unresolved. Do not silently turn it into a prepared answer or award invented scores. The team may retry within the remaining time or end with an incomplete evaluation.
10. The final feedback operation receives only committed decisions and explicitly unresolved actions. It returns a summary, strengths, risks, and suggested improvements. A deterministic history summary is the fallback.

Mapping custom actions into a finite authored outcome set is a recommendation. It makes the existing prepared paths consistent, but limits novel consequences. Fully dynamic story generation is a larger alternative the team may choose separately.

## 9. End conditions and deadline precedence

The game has one server owned total deadline and a decision sequence defined by the scenario.

1. A terminal scenario outcome ends gameplay after its result is recorded.
2. Reaching the total deadline ends gameplay immediately. Proposed: total timeout takes precedence over a speaking deadline, a voting deadline, a CEO decision, or an AI completion processed at the same instant.
3. A pending AI operation that completes after gameplay ends may not change the ending or metrics. The unresolved selected action remains visible in the final record.
4. A host end action records `host_ended`, so it cannot be mistaken for a completed scenario or a timeout.
5. Final feedback generation is separate from gameplay completion. Clients can display the final factual record while feedback is pending.

The total duration is deliberately configurable and has no silently selected default. The team must choose a value consistent with speaking time and the number of decision nodes.

## 10. Rejoin and persistence boundary

Basic rejoin is required. On reconnect, authenticate the original membership and send the current snapshot, current phase, speaker, deadlines, the member's accepted vote, and the last committed decision. Never create a replacement vote or replay a completed action merely because a socket reopened.

The meeting continues during a network interruption. Its timers are not paused. Past socket messages do not have to be replayed if a complete current snapshot is sent.

Proposed first deployment: keep active room state in one running backend process. A browser refresh or temporary network disconnect can recover against that process. A process restart loses active rooms. This distinction is explicit because server restart recovery was deferred. FastAPI's own [WebSocket example documents the same single process limitation for memory held connections](https://fastapi.tiangolo.com/advanced/websockets/).

Database backed recovery, durable event history, and deployment across multiple backend processes are selectable later capabilities. They require persistence and coordination together. Adding a database alone does not make process local room locks or socket broadcasts work across workers.

## 11. Function catalog for team selection

The team may choose delivery order without treating the following groups as completed implementations.

1. F01 Room lifecycle: create, code based join, lobby, role assignment, start, end, 3 to 20 player constraints.
2. F02 Scenario loading: package validation, pinned version, prepared options, authored consequences, and no decision paths.
3. F03 Meeting flow: ordered speaker turns, deadlines, finish early, skip, current speaker display.
4. F04 Voting: one equal vote per member, 60 second deadline, proposed replacement and secret ballots, deterministic tally.
5. F05 CEO decision: tied option selection, timeout, proposed reassignment, and no decision fallback.
6. F06 Custom actions: proposal entry, frozen content, voting, AI evaluation, allowed outcome mapping, and visible failure.
7. F07 Shared state: live snapshots and updates for all connected members.
8. F08 Results: decision history, terminal or timeout reason, rubric based evaluation, AI debrief and fallback.
9. F09 Basic rejoin: existing seat recovery while the process and meeting continue.
10. Optional F10 Scenario document generation: three draft documents once topics and format are chosen, validation, and team review before play.
11. Optional F11 Media: in app voice transport, transcription, generated speech, or text chat if selected.
12. Deferred F12 Durable recovery: database storage, recovery after restart, event retention, and multiple backend workers.

F03 and F04 require F01, F02, and F07. F05 requires F04 and a valid CEO. F06 requires voting plus the AI contract and authored outcome references. F08 requires actual decision records; AI prose is an enhancement of those records. F09 requires stable membership from F01. F10 does not replace scenario validation in F02. F12 is necessary before enabling multiple backend workers.

Recommended delivery order is one prepared scenario through F01, F02, F04, F05, and F07, followed by F03, F06, F08, and F09. This is an implementation order for later approval, not removal of agreed functions.

## 12. Acceptance examples

1. Two connected members cannot start. Three can. A twenty first seat cannot join a full room.
2. A host who is not the CEO cannot decide a tie without an explicit allowed reassignment. A CEO cannot select an option that is outside the tied leaders.
3. Twenty simultaneous votes are counted by member identity, not connection count. Duplicate retries add no votes. Vote replacement leaves one vote per member.
4. Votes processed exactly at the deadline are rejected. Competing close triggers resolve the round only once.
5. A disconnected voter can rejoin the same seat. The existing vote and current speaker state are restored. The meeting clock has continued.
6. A repeated speaker timeout does not skip two players. An old timer from a prior round cannot close the new round.
7. A custom winner can map only to an allowed outcome. Invalid AI output leaves an explicit unresolved action and does not corrupt scenario state.
8. AI completion after total timeout does not advance the story. Final feedback identifies the unresolved action.
9. A normal prepared winner uses its authored consequence without needing a successful AI request.
10. A zero vote round takes its authored no decision outcome. A positive tie waits for the CEO and follows the documented fallback if no choice arrives.
11. Separate rooms cannot see or mutate each other's members, votes, timers, or state.
12. The final feedback agrees with committed decisions and end reason. If AI feedback fails, the factual result page still works.

These are required future verification cases. They have not been executed against a backend because no backend exists yet.

## 13. Remaining choices, not blockers to drafting

The team still chooses the actual scenario content and document topics, complete role roster, who supplies the scenario and AI integration, speaker and total session durations, scoring rubric, AI provider, delivery deadline, hosting target, simultaneous room target, and any changes to the marked Proposed policies. Prepared scenario files are still needed before a real scenario can be validated.

## 14. Sources

The product requirements come from the user's written answers and latest voice discussion, with the earlier [shared ChatGPT conversation](https://chatgpt.com/share/6aef6dba-c374-83ea-84ab-a9f4de9925ed) providing project context. Recommendations are the architect's proposals. Framework facts are supported beside their relevant claims by official documentation.
