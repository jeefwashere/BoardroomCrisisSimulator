# Rehearsal prototype and service guide

Route A from [the supplied architecture](architecture.md): a Python backend owns
the exercise, local LFM3/GLiNER adapters interpret scoped requests, and optional
ElevenLabs speech APIs handle audio. The shared model playground is available separately. See [the selected architecture](ai-architecture.md) for production integration boundaries.

## Run the small tests

Python 3.11+ is sufficient for the controller and offline tests. No packages or API
credits are needed:

```sh
# Run from the repository root
python3 -m unittest discover -v
python3 -m rehearsal demo
```

The demo starts an ephemeral localhost HTTP server, joins three independently
authenticated participants, captures contributions, proposes an action, confirms
it as the chair, retries confirmation, requests IT's response, advances a test
clock, and writes an evidence linked debrief to `artifacts/demo.json`. Its artificial
clock is confined to the demo; the normal API uses server wall time.

## Operator access to the local models

This section is only for agents explicitly authorized to administer the owner's Velocity account. Teammates should use the shared HTTPS API described below.

The nine requested model snapshots and checksum manifest are on Velocity:

```text
/home/abehl/worldmodel/runs/boardroom-local-models-2026-11-07/
  models/<publisher>/<model>/
  download-status.json
  .venv/
  rehearsal/
  logs/
```

Exact revisions, file sizes and weight checksums are also in
[cluster-downloads/download-status.json](../cluster-downloads/download-status.json).
All models were downloaded; only `LFM3-1.7B` and `GLiNER2.5-base` are used by this prototype.
The other models have not been loaded or benchmarked.

The inference gateway binds to `127.0.0.1:8877` on `max-compute-11`, uses a secret
bearer token, and must run inside job **20031** on the assigned GPU. LFM3 uses the GPU;
GLiNER uses CPU. The task virtual environment inherits the existing Torch installation
and adds the pinned packages in `requirements-local.txt`, without modifying shared packages.

Open a tunnel from your Mac while the allocation and gateway are running:

```sh
ssh -N -J abehl@max-velocity.uwaterloo.ca \
  -L 8877:127.0.0.1:8877 abehl@max-compute-11
```

The locally configured
`LOCAL_MODEL_URL` and `LOCAL_MODEL_TOKEN` are read from `.env.local`; never expose
the gateway publicly. Then run:

```sh
python3 -m rehearsal model-smoke
python3 -m rehearsal demo --local-model --output artifacts/demo-local.json
```

`model-smoke` records actual round trip latency, extraction results and GPU memory.
`demo-local` reports whether a character response used the model or authored fallback.
Inspect these fields rather than assuming that a successful demo proves model quality.

The allocation expires at **2026-11-08 15:46:25 UTC (10:46 AM Toronto)**. Files persist,
but running services are killed then. Check `squeue` before using the gateway; never
create or cancel allocations from this project. Follow the workspace `GPU_ACCESS.d`.

## Run the controller API

`REHEARSAL_ADMIN_TOKEN` has been generated into the ignored `.env.local` for this
workspace. On another machine, copy `.env.example` and set your own random token.

```sh
python3 -m rehearsal serve
```

The API listens on `http://127.0.0.1:8765`. SQLite state persists at
`.local/rehearsal.sqlite`. Requests are JSON; authenticated requests use
`Authorization: Bearer <token>`. There is no browser CORS interface in this prototype.

| Route | Authorization | Purpose |
|---|---|---|
| `GET /health` | None | Controller health |
| `GET /preparation` | Organizer token | Reviewed fictional scenario and documents |
| `POST /sessions` | Organizer token | `participants`: list of `{id,name,role}`; one chair |
| `POST /sessions/:id/join` | Issued invitation | `{invitation}` returns a participant token |
| `GET /sessions/:id/state` | Participant | Current public state, log, queue and climate suggestions |
| `POST /sessions/:id/contributions` | Participant | `{segment_id,text,source,committed}` |
| `POST /sessions/:id/proposals` | Participant | `{request_id,action,action_kind,owner,rationale,review_time,evidence}` |
| `POST /sessions/:id/decisions/:decision/confirm` | Chair | Explicit, idempotent confirmation |
| `POST /sessions/:id/decisions/:decision/defer` | Chair | Keep a deferred action visible |
| `POST /sessions/:id/talk` | Participant | `{request_id,role,text}` explicitly addresses a character |
| `POST /sessions/:id/coordination` | Participant/chair | Raise, invite, finish/pass, pause/resume, resolve question |
| `POST /sessions/:id/speech` | Chair/shared speaker client | Claim, complete, fail or interrupt queued speech |
| `POST /sessions/:id/debrief` | Participant | Findings with actual event/document references |

The demo in `rehearsal/__main__.py` is an executable HTTP client example for all
essential steps. Identity comes from the participant token, never a request body
participant ID or a model's output. An invitation is a bearer credential and should
be given only to its intended participant.

## Optional speech tests

Default voice spending is **$0**. The offline demo and model smoke tests never call
ElevenLabs. To see available voices, this read only command uses the configured key:

```sh
python3 -m rehearsal voice voices
```

The `voice opening` command generates a short fictional opening as MP3 and captions.
The `voice transcribe --wav <file>` command accepts an explicitly chosen WAV of
0.1 to 30 seconds and returns a provisional transcript for review. These are separate
speech APIs, not the old managed mood agent. No microphone is opened automatically.

For billable tests, supply `--max-usd`, and a currently verified account/model price
with `--tts-per-1k` or `--stt-per-minute`. For example, after verifying prices:

```sh
python3 -m rehearsal voice opening --voice-id YOUR_VOICE_ID \
  --max-usd 0.10 --tts-per-1k YOUR_VERIFIED_PRICE
python3 -m rehearsal voice transcribe --wav fictional-test.wav \
  --max-usd 0.10 --stt-per-minute YOUR_VERIFIED_PRICE
```

The persistent ledger at `.local/voice-budget.sqlite` reserves estimated cost before
each request, does not refund failures, and stops further calls at the configured
cap. The cap is based on the supplied rates; it is not a provider enforced billing
limit. TTS is cached, and generation is never automatically retried. Generated audio
is saved, not automatically played. A future playback client must claim one queued
utterance, check its round/status before playback, interrupt promptly, and mark
delivery only after playback actually completes.

## What is implemented and what remains experimental

1. Authored preparation fixture, facilitator/IT/journalist roles, evidence based
  deterministic debrief, turn queue, 15 minute server timer, draft/confirmation
  workflow, contribution tracker and discussion climate suggestions.
1. LFM3 selects allowed authored fact IDs. The controller publishes the exact cited
  facts, not arbitrary model prose. This intentionally limits conversational variety.
1. GLiNER suggests contribution classes and text spans. Owners and actions still
  require human review; no extraction can confirm a decision. Raw scores are not
  presented as calibrated confidence.
1. Model outages fall back to authored text/rules. A slow model call never holds the
  session database lock. Partial text and repeated segments cannot change decisions.
1. Decision findings retain the released information available at confirmation time.
  Uncaptured speech is unobserved. No mood, personality or competence score is produced.
1. No arbitrary document ingestion pipeline, optional d1/emotion2vec/SenseVoice runtime,
  managed ElevenAgents route, realtime microphone streaming, or complete multiplayer
  frontend is included. The separate hosted model lab and API are implemented.
  The planned FastAPI room service still requires integration and evaluation.

See `tests/test_rehearsal.py` for the executable authorization, state, evidence,
failure, interruption, timing and budget checks.

## Shared website and application API

Team portal: https://rehearsal-gpu-lab-team22.arjunb3hl.chatgpt.site

The three invited emails can use the playground. Your deployed application can
call the HTTPS API directly using server credentials; its users do not need a
Velocity or ChatGPT account. The API uses an outbound polling worker inside job
20031, so it does not depend on this Mac remaining online. Nothing exposes the
compute node's HTTP port to the Internet.

The ignored `.env.local` contains `REHEARSAL_API_URL`, `REHEARSAL_SITE_TOKEN`,
and `REHEARSAL_APP_KEY`. Configure those three variables in your application's
**server** hosting environment. Never put them in frontend code or `NEXT_PUBLIC_`
variables. The application credential has its own shared request history; individual
portal members have separate histories keyed by their authenticated user IDs.

Test from this checkout:

```sh
python3 -m rehearsal.hosted 'Suggest three questions for a board chair.'
python3 -m rehearsal.hosted --model gliner-base 'Jeff will call IT before 3 PM.'
```

Python applications can use `rehearsal.hosted.HostedModels().run(prompt)`;
Node backends can import `runLocalModel` from `examples/hosted-models.mjs`.
`POST /api/jobs` accepts `{request_id, model, prompt}` and returns `{id}`;
`GET /api/jobs?id=...` returns the caller's job. Poll until `done` or `failed`.
Both require `Authorization: Bearer <REHEARSAL_APP_KEY>` and
`OAI-Sites-Authorization: Bearer <REHEARSAL_SITE_TOKEN>`.
Results are JSON strings in the job's `result` field. A successful result contains
`text` for `lfm3`, or advisory `kind`/`spans` for `gliner-base`.

Only these two models are enabled. Seven other checkpoints are downloaded and
verified but require runtime integration before serving. Requests are serialized,
limited to 4,000 characters, 3 pending per identity, and 60 submissions per hour.
The LFM output cap is 256 tokens. Generation suggestions do not confirm decisions.
A queue completion is persisted on the GPU filesystem before reporting it, so
network retries do not regenerate an already completed response.

The GPU allocation ends **November 8, 2026 at 10:46:25 AM Toronto**. The site and
stored history remain, but inference stops; continued service needs a newly
authorized allocation. The owner can revoke application access by replacing the
hosted `APPLICATION_KEY_HASH` secret and redeploying. Replace the corresponding
local/hosting `REHEARSAL_APP_KEY` at the same time. Worker access uses its own secret.

Remote processes and logs are under
`/home/abehl/worldmodel/runs/boardroom-local-models-2026-11-07`:
1. `boardroom-gateway-web-20261107-1932`: localhost inference gateway.
1. `boardroom-queue-fixed-20261107-1924`: outbound queue worker.

Do not print `queue-config.json` or `model-token`; they contain credentials.
