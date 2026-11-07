# Automatic coding agent communication

Use [issue 6: Agent Board, Ricardo and Jeff](https://github.com/jeefwashere/BoardroomCrisisSimulator/issues/6) for messages between the two real coding agents. The participants are `RicadoGz` and `jeefwashere`. The issue is pinned and the initial connection request is posted.

## 1. Automatic trigger

1. Ricardo's agent posts a comment and mentions Jeff.
2. The watcher on Jeff's computer checks GitHub every 30 seconds.
3. It finds new comments from Ricardo's account, remembers their IDs, and passes them to Jeff's exact Codex conversation using `codex queue --thread SESSION_ID --message MESSAGE --resume`.
4. Codex receives the queued message and handles it under Jeff's current task. When the session is not loaded, the command asks the running Codex daemon to resume it.
5. Jeff's agent replies on the same issue. Ricardo's watcher performs the same steps in the opposite direction.

Each teammate starts the watcher once in the chosen Codex session. There is no need for a person to ask the agent to read every new comment. GitHub stores messages; the watcher detects them; Codex delivers them to the conversation.

This adapts the original [agent board pattern](https://github.com/azizu06/hackathon-agent-board): one issue, GitHub account routing, incremental comment cursors, and 30 second polling. The Codex session queue supplies the automatic delivery that the original template supplies mainly through Claude Code background results and hooks.

## 2. Prerequisites on each computer

1. Python 3.10 or newer, GitHub CLI, and Codex CLI with `codex queue --resume` support.
2. Each teammate uses their own GitHub account and can read and comment on this repository.
3. The computer remains available and the local Codex daemon remains running. Closing or disabling the daemon can prevent automatic resume. GitHub retains the comments.
4. Choose one existing Codex conversation per teammate for board communication. Other project tasks can keep working without starting their own listeners.

Check the tools inside that Codex session's shell:

```bash
gh api user --jq .login
codex queue --help
```

If GitHub authentication is missing, run `gh auth login --hostname github.com` once. This channel uses GitHub authentication. It does not use `REHEARSAL_APP_KEY` or the application model service.

## 3. Start once from the chosen Codex conversation

From the project directory, ask Codex to run:

```bash
python3 tools/board_watch.py start
```

The script takes the exact session UUID from `CODEX_THREAD_ID`. It infers the other teammate from the current GitHub login, starts a detached local watcher, and prints the bound thread, PID, and state path. An explicit UUID can also be supplied with `--thread`.

The watcher uses the same session and model already selected in Codex. It does not create a new agent for each comment. A comment received while that conversation is busy is queued for the conversation to handle.

## 4. Jeff's branch can start without switching branches

If Jeff's current branch does not have the script yet, his Codex can download the published copy into local ignored state:

```bash
mkdir -p .board
gh api 'repos/jeefwashere/BoardroomCrisisSimulator/contents/tools/board_watch.py?ref=main' \
  -H 'Accept: application/vnd.github.raw+json' > .board/board_watch.py
python3 .board/board_watch.py start
```

Before downloading, make sure `.board/` is ignored. If the branch has not received the shared `.gitignore`, add `.board/` to the local exclude file reported by `git rev-parse --git-path info/exclude`. Keep current working changes and branch ownership intact.

Give Jeff's Codex this instruction once:

```text
Connect this existing Codex conversation to our shared board:
https://github.com/jeefwashere/BoardroomCrisisSimulator/issues/6

Read the automatic setup guide on main:
docs/agent-board-setup.md

Use my own GitHub CLI login. Start the board watcher once in this conversation.
Use tools/board_watch.py from main, or download it into the ignored .board
folder if my branch lacks it. Bind it to this exact CODEX_THREAD_ID.
Preserve my current branch and working changes.

When Ricardo's comments arrive automatically, handle them within my assigned
work and reply on issue 6. Start replies with [Jeff's Agent] and mention
@RicadoGz when Ricardo needs to respond. Avoid acknowledgment loops.

For the initial connection, reply with your actual agent name, branch,
assigned task and files, and confirmation that the watcher is running.
```

## 5. Send messages

An agent posts a normal comment through GitHub CLI:

```bash
gh issue comment 6 --repo jeefwashere/BoardroomCrisisSimulator \
  --body "[Jeff's Agent] @RicadoGz I have a question about the join room contract."
```

Use real details instead of the example. Ricardo uses `[Ricardo's Codex]` and mentions `@jeefwashere`. For longer messages, write the exact text to a temporary file and pass it with `--body-file`.

The watcher accepts comments only from the configured teammate account. Other accounts and the receiver's own comments do not trigger it. It includes all new teammate comments, as the original board does; the receiving agent decides whether a mention or changed contract requires action. Replies should contain a question, answer, blocker, handoff, or verified change rather than another receipt acknowledgment.

## 6. Check and stop

Run these from the same Codex session, or add `--thread` with the UUID printed at startup:

```bash
python3 tools/board_watch.py status
python3 tools/board_watch.py stop
```

If using Jeff's downloaded copy, replace `tools/board_watch.py` with `.board/board_watch.py`. Stop requests are checked every second. The script keeps its read cursor for a later restart.

State and logs live under `agent-board` in Git's common metadata directory, usually `.git/agent-board`. They are local metadata and are not committed. Linked worktrees share this directory, so changing worktrees cannot accidentally create a second listener for the same conversation. The optional downloaded script remains in `.board/`. Status includes the last poll time, last delivered queue message, and any error. An active process lock distinguishes a running watcher from an old state file.

A failed GitHub read leaves the cursor unchanged and is retried at the next poll. A queue attempt with an uncertain outcome preserves its pending comment IDs and stops rather than risking duplicate delivery. Codex can accept a queued message but fail to resume its session; such a warning is recorded separately from acceptance. Check the daemon and the existing session before restarting after a delivery error.

## 7. Work and verification boundaries

Jeff owns the pages before game start; Ricardo owns the backend. Gameplay frontend ownership remains unassigned. Keep task ownership and completion evidence in `TODO.md`. Comments are coordination context under the user's task and repository instructions. They do not replace commits, permissions, or review of overlapping edits.

The source watcher tests cover peer filtering, exact thread routing, duplicate suppression across restarts, uncertain queue outcomes, resume warnings, batched messages, incremental fetches, shared worktree locking, and reloading the cursor after acquiring ownership. A real queue test resumed an existing explanation conversation and received `BOARD_TRIGGER_OK`. A clearly labeled synthetic record then passed through the actual watcher delivery function and that conversation replied `BOARD_WATCHER_TRIGGER_OK`. The synthetic record was local test data, not a message from Jeff.

Jeff still needs to start his local watcher once. An actual reply from Jeff's agent is required before claiming that both computers are connected. Local tests and Ricardo's published first comment alone do not prove that round trip.

## Sources

1. [Live board](https://github.com/jeefwashere/BoardroomCrisisSimulator/issues/6).
2. [Original board implementation](https://github.com/azizu06/hackathon-agent-board/blob/main/tools/board).
3. [Original Claude session hook](https://github.com/azizu06/hackathon-agent-board/blob/main/.claude/hooks/board-session-start.sh).
4. [Official OpenAI documentation for Codex queue](https://learn.chatgpt.com/docs/developer-commands#codex-queue).
5. [GitHub CLI issue comments](https://cli.github.com/manual/gh_issue_comment).
