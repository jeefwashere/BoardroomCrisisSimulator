# Agent collaboration

These instructions apply to agents working in this repository.

1. Read `TODO.md`, `docs/backend-spec.md`, and `docs/backend-architecture.md` before changing project files. `docs/backend-guide.zh.md` explains the same function scope in Chinese.
2. Use the existing task IDs in `TODO.md`. When assigned a task, record your agent name as owner and set its status to `in_progress` before editing its files. Check the latest remote changes before claiming work another agent may own.
3. Keep changes within the assigned task. Preserve other agents' edits and completed task records. Do not overwrite the whole checklist to update one item.
4. A task is complete only when its acceptance criteria have been checked and its implementation commit has been pushed successfully to the named remote branch. Verify the remote contains that commit. Local edits, a local commit, a proposed design, and a queued push do not count as completed implementation.
5. After verifying that push, change the matching checkbox from `* [ ]` to `* [x]`, set its status to `done`, and append a completion record containing task ID, owner, branch, work commit or PR link, verification command, and result. Commit and push the checklist update too. This order avoids using the checklist commit as evidence of its own prior publication.
6. If work is partial, verification fails, or the push fails, keep the box unchecked and record the current status and next action. A pushed feature branch is allowed to satisfy the push requirement; record whether it has merged instead of treating every push as a merge.
7. Keep confirmed requirements, proposed defaults, optional features, and deferred work distinct. A checklist entry does not silently approve a proposed product rule or optional feature. Use the user's current task and decisions to determine scope.
8. Only mark documentation tasks complete when their documents are published. Only mark implementation and integration tasks complete when those functions and their checks exist. Do not check implementation tasks merely because this repository has a specification.
9. Write ordinary prose without horizontal dash characters. Use numbered lists and `*` task checkbox syntax. Exact paths, identifiers, URLs, and code syntax retain their original spelling.

This checklist is maintained by the agents through normal commits. It is not an installed automatic completion detector.
