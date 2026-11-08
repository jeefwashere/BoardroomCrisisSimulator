# Rehearsal meeting playtest

Latest: [Round 1 implementation](ROUND_ONE_REPORT.md), [full four round design](FOUR_ROUND_DESIGN.md), and [current test guide](ROUNDTABLE_GUIDE.md). Earlier custom voting audio remains in the legacy flow.

Working branch: **`experiment/ai-voice-playtest`**. Read [the implementation and branch summary](IMPLEMENTATION_SUMMARY.md) for the current handoff and verification status.

Open <http://127.0.0.1:8788/>. The page automatically attaches one incident PDF. Click **Load 3 test participants**, then have the CEO **Start meeting**. A roughly 30 second live spoken preparation introduction leads into a five minute discussion.

Each participant card shows whose turn it is. Manually play the current turn's saved clip, stop it, or commit its exact caption and pass the turn. There is no participant autoplay. Nine distinct T01 turns unfold across three participant voices, progressing through proposals, challenges and a summary in 134.40 seconds. The script does not loop after turn nine; typed discussion may continue. A separately labelled saved decision guide explains the choices; adviser replies use live Gemini and ElevenLabs.

Discussion leads into a visible one minute adviser consultation stage. The CEO can finish discussion early and skip the adviser minute. The default T01 meeting then plays a saved 21.97 second decision guide and opens three authored responses, with up to three additional human supplied custom choices. The UI asks each member by name and requires Choose this response followed by Confirm my vote. First ballots follow the server enforced member order. The single window test view advances to the next member, then returns to the CEO; the CEO commits the winner or resolves a tie, and a live evaluation agent interprets that actual result. Written minutes and the transcript stay beside the discussion. Microphone input remains explicit: record, transcribe, review and separately commit.

[Read the test guide](ROUNDTABLE_GUIDE.md), [open its formatted version](http://127.0.0.1:8788/roundtable-guide), or inspect [the streaming measurements](STREAMING_PREPARATION.md). The standalone guide is `/Users/arjunbehl/Downloads/Rehearsal_Roundtable_Guide.html`.

## Run locally

Use the existing virtual environment and backend environment file. The current owner's worktree can start with:

```sh
.venv/bin/python -m playtest \
  --env-file ../BoardroomCrisisSimulator/.env.local \
  --unlimited-budget \
  --allow-name-rejoin
```

The user explicitly removed app spending caps. `--unlimited-budget` stores that authorization for both Vertex and ElevenLabs while preserving the existing ledgers. Future restarts retain it. Usage is tracked, but cap and remaining allowance are null and calls are not blocked by an application credit limit. Do not reset or replace the ledgers. Provider account billing and availability remain outside this app setting.

For a fresh environment, install `playtest/requirements.txt` and the optional `playtest/requirements-memory.txt` into its virtual environment. Follow [PDF memory setup](PDF_MEMORY.md) to explicitly download and index the selected model. No model download occurs on page load. The CLI warms the cached reader before allowing the timed meeting to start.

## Agents and authority

| Component | Current responsibility |
| --- | --- |
| Gemma embedding memory | Retrieve page cited passages from PDFs attached to this room. |
| Gemini preparation | Introduce the actual incident and preserve unknowns. |
| Gemini facilitator, IT adviser and journalist | Reply when consulted by the CEO using the report and discussion. |
| Recorded T01 decision guide | Explain prepared and custom responses without contributing, voting or choosing. |
| Gemini evaluation | Interpret the actual committed proposal and result. |
| Gemini minutes | Select exact discussion quotes for the side summary. |
| ElevenLabs Flash v2.5 | Stream each live agent's generated words as speech. |
| ElevenLabs Scribe v2 | Return provisional text from an explicitly submitted microphone clip. |
| Backend | Enforce readiness, roles, clocks, turn eligibility, ballots and committed results. |

Text generation uses Gemini 3.8 Flash with LOW reasoning through Vertex Express. EmbeddingGemma runs locally on CPU using cached weights. Live adviser speech is streamed PCM. Saved participant clips and the separate recorded decision guide are labelled distinctly; the guide is not a participant contribution. All live model output remains advisory and sources stay visible.

The fixed ballot applies only when T01 is the sole attached document. Its responses are Controlled continuity, Technical checks first and Wait for the director. Any member may add custom responses during decisions, up to three total for the ballot, with an 80 character title and 1,500 character proposal. Adding an option changes the ballot version and clears all votes; if ballots exist, an explicit reset acknowledgement is required. All members must vote again using Choose and Confirm. A custom winner becomes the canonical committed proposal and is passed to live evaluation. All members must explicitly vote before CEO commitment. The CEO can choose only among tied leaders, cannot override a clear winner, and cannot cancel the fixed ballot. Other document selections retain the earlier custom proposal flow. The recorded guide never creates a contribution or a vote.

## Storage and scope

Provider keys remain in the ignored backend environment file. No credentials are placed in frontend code, URLs or exports. Each test seat has its own bearer membership token in browser session storage. Room membership scopes both PDF retrieval and audio access; display names are not production account identity.

This is one process on localhost. Restarting loses rooms, so export the written record first. The ignored `.local/ai-playtest` directory retains model weights, PDF vectors, uploaded documents, caches and both usage ledgers. Uploaded PDF attachments do not survive a room restart; a new room receives only the public default PDF. The app is not an Internet deployment and does not grant Velocity access.

The separate recorded audio website was removed: `/audio-lab` and `/audio-guide` return 404. Its old files and [historical recording report](AUDIO_REPORT.md) remain for development history, while the new T01 participant recordings and decision guide are served directly on the main meeting page. Older `/classic` and `/meeting` experiments are retained for regression work, not the current recommended workflow. Their original measurements are in [the local report](MEETING_REPORT.md), [Vertex comparison](VERTEX_REPORT.md) and [prior PDF meeting report](ROUNDTABLE_REPORT.md).

The experiment is isolated on `experiment/ai-voice-playtest`. It does not replace teammate production modules. No GPU allocation or local conversation API is required.

## Verify

```sh
.venv/bin/python -m unittest discover -s playtest/tests -q
.venv/bin/python -m unittest discover -s tests -q
.venv/bin/python -m rehearsal demo
node --test playtest/tests/*ui.test.cjs
```

The current explicitly paid live harness is `python -m playtest.extended_round_benchmark --live`. It exercises the extended recorded discussion, a custom response, explicit ballots and evaluation. Results belong in [the extended conversation report](EXTENDED_CONVERSATION_REPORT.md). The earlier streaming harness remains available for regression work. HTTP checks do not establish browser listening, human microphone or visual quality; those remain unverified.
