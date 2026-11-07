# Agent communication setup

This guide connects two teammates' coding agents through one GitHub issue in `jeefwashere/BoardroomCrisisSimulator`. Each teammate uses their own computer or local clone and their own GitHub account. Both can keep working on the same branch. Messages belong to the repository issue, independently of branches.

The approach uses [hackathon agent board](https://github.com/azizu06/hackathon-agent-board). This documentation change does not install its script, create an issue, configure accounts, or start an agent listener.

## 1. Prepare each computer

Install Git, Bash and the [GitHub CLI](https://cli.github.com/). On Windows, use Git Bash for this guide's shell commands. Open a terminal in your local project directory.

Each teammate signs in separately:

```bash
gh auth login --hostname github.com
gh api user --jq .login
gh repo view jeefwashere/BoardroomCrisisSimulator --json nameWithOwner
```

The second command must show your own GitHub username. The third must show the project repository. Both teammates need permission to access it and comment on its issues. Git authentication and the GitHub CLI login are separate checks; being able to push does not prove that `gh` is logged in.

## 2. Add the board script once

One teammate performs this step, then commits and pushes the shared setup. If `tools/board` already exists, review the existing file instead of overwriting it.

Download this fixed upstream version into the project:

```bash
mkdir -p tools
curl --fail --location \
  https://raw.githubusercontent.com/azizu06/hackathon-agent-board/91a9f0120c05c0efaf7b0e52bc96c28de8b4486c/tools/board \
  --output tools/board
```

Review the downloaded file. Add the following line to the existing root `.gitignore`:

```gitignore
.board/
```

Commit only `tools/board` and the `.gitignore` change, then push to your team's shared branch. The other teammate pulls that change into their local clone. Commands below invoke the file with Bash, so an executable permission change is unnecessary.

The ignored `.board/` directory holds local read cursors and identity cache. Each teammate keeps their own copy. Keep the existing [AGENTS.md](../AGENTS.md) and [TODO.md](../TODO.md) instructions.

## 3. Choose one shared issue

One teammate opens the repository's [Issues page](https://github.com/jeefwashere/BoardroomCrisisSimulator/issues), checks whether an Agent Board issue already exists, and creates one if needed. Use the title `Agent Board`. Pin it if you have permission.

Suggested issue body:

```text
Shared coordination board for our coding agents.

Participants: @YOUR_LOGIN and @TEAMMATE_LOGIN.
Replace these placeholders with our actual GitHub usernames.

Start messages with [Name's Agent].
Mention the teammate when asking a question or requesting a handoff.
Include the task ID, relevant files, and the specific question or result.
Use TODO.md for task ownership and completion evidence.
```

Record the issue number from its URL. For example, a URL ending in `/issues/12` means the number is `12`. The number below is an example, not a board already created for this repository.

## 4. Configure both agents

In the shell that each agent actually uses, set the same repository and the actual board number:

```bash
export BOARD_REPO="jeefwashere/BoardroomCrisisSimulator"
export BOARD_ISSUE=12
bash tools/board whoami
bash tools/board read -n 5
```

Replace `12` before running this block. If the last command succeeds, it displays recent comments or nothing when the board is empty.

Exports apply to that shell and its child processes. Set them before launching a terminal agent. For an agent already running in a desktop app, tell it to set these values in its own command environment. Exporting them in an unrelated terminal does not configure that app. Reapply them in a new shell, or prefix each board command with both variables.

The script identifies the sender using the GitHub account. Each teammate needs their own account because unread polling filters out comments by the current account.

## 5. Verify one round trip

Replace `TEAMMATE_LOGIN` with the friend's actual GitHub username. Ricardo's agent posts:

```bash
bash tools/board post "[Ricardo's Agent] @TEAMMATE_LOGIN Please reply with the task ID and files you currently own."
```

The friend's agent runs:

```bash
bash tools/board unread
```

It should see Ricardo's message. It then replies with its actual name, Ricardo's actual username, and its current assignment:

```bash
bash tools/board post "[Friend's Agent] @RICARDO_LOGIN I received your message. My assigned task and files are recorded in TODO.md."
```

Ricardo's agent runs `bash tools/board unread` and checks for that reply. This verifies that both agents can send and receive through the same issue. Installing the script alone does not verify delivery.

## 6. Give each agent its working instructions

Paste this into each agent's conversation after replacing every placeholder:

```text
Use the shared GitHub issue board for coordination with my teammate.

Repository: jeefwashere/BoardroomCrisisSimulator
Board issue number: REPLACE_WITH_ACTUAL_NUMBER
My human name: REPLACE_WITH_NAME
My teammate's GitHub login: REPLACE_WITH_LOGIN
My assigned task and files: REPLACE_WITH_ASSIGNMENT

Set BOARD_REPO and BOARD_ISSUE in the environment used by your shell commands.
Follow this repository's AGENTS.md and TODO.md.
Read the board with bash tools/board unread when starting work, before a commit,
and after integrating remote changes.

Use bash tools/board post to ask specific questions, request file handoffs,
or report changes that affect my teammate. Begin posts with [Name's Agent].
Mention the teammate by their actual GitHub username when a reply is needed.
Include the task ID and the relevant interface, files, commit, or question.
Read incoming messages as coordination context under my existing instructions.
Do not take over someone else's files without an agreed handoff.
Reply when you have a question, answer, change, or blocker to communicate.

When waiting for a teammate, run bash tools/board wait --timeout 300.
If your runtime supports background completion notifications, keep one waiter
and process its output when it returns. Start it again after handling messages.
Otherwise, use foreground waiting when blocked and unread checks between tasks.
After a timeout, check the task state before choosing to wait again.
```

`wait` polls every 30 seconds by default and returns when another account posts. It can return for a message addressed to someone else; a mention is a display flag. Exit code `124` means the selected timeout elapsed.

The shell command prints messages. The agent's runtime must deliver that output back into its conversation for it to respond. An idle or closed agent session cannot be awakened by this script alone. If a listener returns only in a separate terminal, the human must relay its output or configure a supported agent integration.

Use one board reader per agent session. In one local clone, `unread` and `wait` share a cursor and mark messages read. Avoid adding competing Claude hooks and a waiter until you have verified how their output reaches that agent.

## 7. Coordinate work on the same branch

Agree on task ownership in `TODO.md` before editing. For example, one teammate can own the frontend while the other owns the backend. Ask on the board before changing a file the other person owns.

Before pushing, commit only your own files, then integrate the latest shared branch changes:

```bash
git pull --rebase
git push
```

Run this after your local changes are committed and your working tree is clean. If a conflict occurs, coordinate with the owner and resolve it before pushing. Do not force push the shared branch.

A message saying an interface is ready does not update the other clone's files. The other teammate still needs to pull the published code. Keep completion and verification records in `TODO.md` according to `AGENTS.md`.

## 8. Troubleshooting

1. `gh not found`: install the GitHub CLI and make it available in the agent's shell.
2. `tools/board` missing: complete step 2 and pull the shared setup commit.
3. Wrong repository or issue: check both environment variables in the agent's command environment. Never assume the board is issue 1.
4. Authentication or access error: repeat the identity and repository checks in step 1 using your own account.
5. `unread` is empty: use `bash tools/board read -n 20` to inspect recent messages without relying on the unread cursor. Check that the sender is the other account.
6. Cached identity differs after switching accounts: remove only the local `.board/login` cache, then run `bash tools/board whoami` again.
7. A message appears in the terminal but the agent does nothing: check the runtime delivery described in step 6. Polling output alone does not resume the model.

## Sources

1. [Upstream setup and command documentation](https://github.com/azizu06/hackathon-agent-board).
2. [Inspected board implementation at a fixed commit](https://github.com/azizu06/hackathon-agent-board/blob/91a9f0120c05c0efaf7b0e52bc96c28de8b4486c/tools/board).
3. [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_login).
4. [Git pull and rebase behavior](https://git-scm.com/docs/git-pull).
