# Shared TODO

这是所有项目 agent 共用的任务清单。完成验证并确认代码已推送后，才勾选对应功能。每个 agent 更新自己的任务和完成记录，再推送清单变更。

This is the shared task list for project agents. A checked implementation task means its acceptance criteria passed and its work commit is on the recorded remote branch. It does not necessarily mean the branch has merged. Follow `AGENTS.md` for the exact update order.

Status values: `available`, `in_progress`, `waiting`, `done`, `optional`, `deferred`. Fill in the owner when taking an assigned task. Proposed behavior remains selectable until the team confirms it.

## Documentation 文档

* [x] D01 Publish the English backend specification. 发布英文后端功能规格。

  Owner: coordinating Codex agent. Status: `done`. Acceptance: the function scope, confirmed decisions, proposed policies, and acceptance examples are published. Evidence: completion record 1.

* [x] D02 Publish the backend architecture. 发布后端架构。

  Owner: coordinating Codex agent. Status: `done`. Acceptance: module ownership, state progression, API catalog, AI contract, and recovery boundary are published. Evidence: completion record 1.

* [x] D03 Publish the Chinese function guide. 发布中文功能说明。

  Owner: coordinating Codex agent. Status: `done`. Acceptance: both English documents have a readable Chinese explanation that preserves confirmed, proposed, optional, and deferred distinctions. Evidence: completion record 2.

* [x] D04 Publish the shared checklist and agent update instructions. 发布共享清单与 agent 更新规则。

  Owner: coordinating Codex agent. Status: `done`. Acceptance: agents can find the checklist, task IDs, ownership, acceptance criteria, and completion evidence rules from the repository root. Evidence: completion record 2.

## Product and content 产品与剧本

* [ ] P01 Record the remaining product choices. 记录尚未确定的玩法规则。

  Owner: unassigned. Status: `available`. Acceptance: record the team's choices for speaking duration, total session duration, vote replacement and visibility, CEO absence, custom action limits and outcome mapping, and scoring. Preserve unsettled choices as proposed.

* [ ] P02 Supply and validate one complete scenario package. 提供并验证一个完整剧本。

  Owner: unassigned. Status: `available`. Acceptance: one background, role list, decision sequence, prepared choices, consequences, allowed custom outcomes, no decision outcome, and ending are available with a fixed version. Do not invent supposedly existing team content.

## Backend 后端实现

* [ ] B01 Create the FastAPI application entry and development setup. 建立 FastAPI 项目入口与本地启动方式。

  Owner: unassigned. Status: `available`. Acceptance: documented local startup succeeds, a health endpoint responds, and API documentation loads. This task does not claim gameplay is implemented.

* [ ] B02 Implement room creation, code based joining, membership, and roles. 实现房间、房间码、昵称、成员身份和角色。

  Owner: unassigned. Status: `available`. Acceptance: start requires 3 connected members, room capacity is 20, host and CEO permissions are distinct, and a name alone cannot reclaim another seat. Supports F01.

* [ ] B03 Implement versioned scenario loading and validation. 实现有版本的剧本加载与校验。

  Owner: unassigned. Status: `available`. Acceptance: reject invalid references and invalid outcomes, pin the room's scenario version, and apply prepared consequences from data. Requires P02. Supports F02.

* [ ] B04 Implement the authoritative room state and transitions. 实现后端统一管理的房间状态和阶段流转。

  Owner: unassigned. Status: `available`. Acceptance: all room mutations use one room owner, duplicate commands cannot repeat consequences, stale phase commands are rejected, and different rooms stay isolated. Supports F01 through F09.

* [ ] B05 Implement HTTP commands and live room snapshots. 实现 HTTP 操作接口和实时房间画面同步。

  Owner: unassigned. Status: `available`. Acceptance: authenticated clients receive the current phase, members, speaker, choices, deadlines, and allowed actions; snapshot versions never move a client backward. Requires B02 and B04. Supports F07.

* [ ] B06 Implement the 60 second equal weight vote. 实现 60 秒等权投票。

  Owner: unassigned. Status: `available`. Acceptance: one ballot per eligible member, no duplicate votes from retries or extra tabs, cutoff checked by the server, deterministic tally, and selected change and visibility rules applied. Requires B03 through B05. Supports F04.

* [ ] B07 Implement CEO tie decisions and no decision outcomes. 实现 CEO 平票决策与无人决策处理。

  Owner: unassigned. Status: `available`. Acceptance: only the CEO chooses among tied leaders, zero votes follow the authored no decision outcome, and the selected CEO absence policy is explicit. Requires B06. Supports F05.

* [ ] B08 Implement sequential speaking and speaker deadlines. 实现轮流发言及发言倒计时。

  Owner: unassigned. Status: `available`. Acceptance: one active speaker at a time, selected duration and skip policy, repeated or old timers cannot skip extra players, and voting begins after speaking. Requires B04 and B05. Supports F03. Audio transport is a separate optional feature.

* [ ] B09 Implement custom action proposals and frozen voting choices. 实现自定义行动提交与投票选项冻结。

  Owner: unassigned. Status: `available`. Acceptance: only eligible members submit during the allowed phase, selected text and count limits apply, and proposal contents cannot change after voting starts. Requires B03, B04, and B06. Supports F06.

* [ ] B10 Implement the AI deciding operation for a selected custom action. 实现获胜自定义行动的 AI 评估。

  Owner: unassigned. Status: `available`. Acceptance: validated provider output maps only to allowed outcomes, provider errors are visible, selected retry policy applies, and late or duplicate results cannot alter ended or newer rounds. Requires B09 and an agreed AI contract. Supports F06.

* [ ] B11 Implement automatic progression and session ending. 实现自动推进、总时限和结束状态。

  Owner: unassigned. Status: `available`. Acceptance: one resolved decision advances exactly once, authored endings and total timeout work, selected deadline precedence applies, and post ending AI results cannot change gameplay. Requires B03, B04, B06, and B07. Supports F03 and F08.

* [ ] B12 Implement decision history, results, and final AI feedback. 实现决策记录、结果页数据与 AI 复盘。

  Owner: unassigned. Status: `available`. Acceptance: final records match committed decisions, unresolved actions are identified, and a factual summary remains available when AI feedback fails. Requires B10 and B11 for the full custom action flow. Supports F08.

* [ ] B13 Implement basic disconnect and rejoin. 实现基础断线重连。

  Owner: unassigned. Status: `available`. Acceptance: the same member returns to the same seat and existing vote while the meeting and clocks continue; refresh does not add a voter or replay a decision. Requires B02, B04, and B05. Supports F09. Server restart recovery is deferred.

## Integration and verification 联调与验收

* [ ] I01 Publish the frontend API and snapshot contract with examples. 提供前端接口、状态数据和错误示例。

  Owner: unassigned. Status: `available`. Acceptance: examples match the implemented OpenAPI contract, the frontend can create, join, start, vote, resolve a tie, observe, and read results. No frontend implementation is implied by documentation alone.

* [ ] I02 Verify one complete multiplayer game. 验证完整多人游戏流程。

  Owner: unassigned. Status: `available`. Acceptance: at least 3 actual client sessions complete join, roles, speaking, vote, consequence, next round, and final feedback. Include one custom winner and one rejoin. Record commands and observed results.

* [ ] I03 Verify concurrency and failure boundaries. 验证并发及异常边界。

  Owner: unassigned. Status: `available`. Acceptance: check the specification's acceptance cases, including 20 simultaneous voters, duplicate commands, cutoff equality, stale timers, CEO absence, provider failure, late AI, zero votes, and room isolation. Passing local unit tests alone does not prove the live client flow.

* [ ] I04 Verify the selected deployment and frontend connection. 验证选定部署方式和前端连接。

  Owner: unassigned. Status: `available`. Acceptance: record the host and commit, verify HTTP plus WebSocket access from the frontend, and document the actual process and persistence boundary. The proposed memory design uses one worker and does not survive a backend restart.

## Optional and deferred 可选与暂缓

* [ ] O01 Generate three reviewed scenario documents after topics and format are chosen. 主题和格式确定后，生成并审阅三份场景文档。

  Owner: unassigned. Status: `optional`. Acceptance: the team chooses the topics, generated content passes scenario validation, and approved versions are available before play. Supports optional F10.

* [ ] O02 Add selected communication or media features. 增加团队选定的聊天、语音或转写功能。

  Owner: unassigned. Status: `optional`. Acceptance: first record which media capability is selected, then verify its actual client flow. Timed speaking alone does not complete this task. Supports optional F11.

* [ ] O03 Add durable recovery and coordinated multiple workers. 增加数据库恢复、重启恢复与多进程协调。

  Owner: unassigned. Status: `deferred`. Acceptance: persist state and command receipts, recover timers and AI jobs, and verify exclusive room mutation plus shared broadcasts. Database installation alone does not complete this task. Supports deferred F12.

## Completion records 完成记录

1. D01 and D02. Owner: coordinating Codex agent. Work commit: [134661e](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/134661e7c8f77fa0be060c13987285022abb2686). Branch: `Ricardo`. Merged through [PR 1](https://github.com/jeefwashere/BoardroomCrisisSimulator/pull/1) into `main` at `86b94184226a6275023b2ce7feba4637de7d5627`. Verification: `git merge-base --is-ancestor 134661e7c8f77fa0be060c13987285022abb2686 origin/main` and `git diff --exit-code origin/main -- docs/backend-spec.md docs/backend-architecture.md` passed after fetch. This proves document publication, not backend functionality.

2. D03 and D04. Owner: coordinating Codex agent. Work commit: [318d14c](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/318d14c6171af0c9870ae5601c6fcfd374c6ea16). Branch: `Ricardo`. Verification: `git ls-remote --heads origin Ricardo` returned the same full commit as `git rev-parse HEAD` after a successful push. `git diff --cached --check` passed before that commit. The GitHub Markdown API rendered all 26 checkboxes, and local link and typography checks passed. Merge status at this completion record: pushed feature branch; the accompanying pull request records the final merge status. No implementation task was marked complete.

For new completions, append task ID, owner, remote branch, work commit or PR link, verification command and result, plus merge status if known. Leave incomplete tasks unchecked.
