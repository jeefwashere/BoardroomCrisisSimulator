# Rehearsal meeting playtest

Open <http://127.0.0.1:8788/>. The page automatically attaches one incident PDF. Click **Load 3 test participants**, then have the CEO **Start meeting**. A roughly 30 second live spoken preparation introduction leads into a five minute discussion.

Each participant card shows whose turn it is. Manually play that participant's saved clip, stop it, or commit its exact caption and pass the turn. There is no participant autoplay. Only three participant recordings are exposed; AI agent speech is always generated live by Gemini and ElevenLabs.

The CEO may consult the facilitator, IT adviser or journalist and can end discussion early. A decision agent prompts the board to choose; people submit and vote on a proposal, the CEO records the result, and an evaluation agent interprets that actual decision. Written minutes and the transcript stay beside the discussion. Microphone input remains explicit: record, transcribe, review and separately commit.

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
| Gemini decision guide | Suggest what the board should decide; cannot create a vote or commit a result. |
| Gemini evaluation | Interpret the actual committed proposal and result. |
| Gemini minutes | Select exact discussion quotes for the side summary. |
| ElevenLabs Flash v2.5 | Stream each live agent's generated words as speech. |
| ElevenLabs Scribe v2 | Return provisional text from an explicitly submitted microphone clip. |
| Backend | Enforce readiness, roles, clocks, turn eligibility, ballots and committed results. |

Text generation uses Gemini 3.8 Flash with LOW reasoning through Vertex Express. EmbeddingGemma runs locally on CPU using cached weights. Agent speech is streamed PCM; it is not chosen from canned audio. The saved clips are explicitly labelled fictional participant contributions. All live model output remains advisory and sources stay visible.

## Storage and scope

Provider keys remain in the ignored backend environment file. No credentials are placed in frontend code, URLs or exports. Each test seat has its own bearer membership token in browser session storage. Room membership scopes both PDF retrieval and audio access; display names are not production account identity.

This is one process on localhost. Restarting loses rooms, so export the written record first. The ignored `.local/ai-playtest` directory retains model weights, PDF vectors, uploaded documents, caches and both usage ledgers. Uploaded PDF attachments do not survive a room restart; a new room receives only the public default PDF. The app is not an Internet deployment and does not grant Velocity access.

The separate recorded audio website was removed: `/audio-lab` and `/audio-guide` return 404. Its old files and [historical recording report](AUDIO_REPORT.md) remain for development history, while the three participant assets are reused on the main meeting page. Older `/classic` and `/meeting` experiments are retained for regression work, not the current recommended workflow. Their original measurements are in [the local report](MEETING_REPORT.md), [Vertex comparison](VERTEX_REPORT.md) and [prior PDF meeting report](ROUNDTABLE_REPORT.md).

The experiment is isolated on `experiment/ai-voice-playtest`. It does not replace teammate production modules. No GPU allocation or local conversation API is required.

## Verify

```sh
.venv/bin/python -m unittest discover -s playtest/tests -q
.venv/bin/python -m unittest discover -s tests -q
.venv/bin/python -m rehearsal demo
node --test playtest/tests/*ui.test.cjs
```

The explicitly paid live harness is `python -m playtest.preparation_benchmark --live`. It exercises all six spoken agent roles, three timed participant clips, early round completion, votes and evaluation. It saves text, sources, streamed timing and accounting evidence without member tokens. The live test is an HTTP simulation, not proof of browser sound or human microphone quality.
