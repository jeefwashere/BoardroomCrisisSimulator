# Agent integration and operations guide

## Start here

This project implements a headless rehearsal controller and a shared local model
service. Read [prototype-guide.md](prototype-guide.md) for commands and
[ai-architecture.md](ai-architecture.md) for the intended product behavior.
Preserve existing user changes. Do not print secrets while inspecting the project.

For application integration, use the hosted HTTPS API. Application users need
neither a Velocity account nor a ChatGPT account. The separate team dashboard
uses invited member sign in.

## Hosted model API

Base URL: https://rehearsal-gpu-lab-team22.arjunb3hl.chatgpt.site

Load these variables from the ignored `.env.local`, or from the deployed
application's server environment:

1. `REHEARSAL_API_URL`: API base URL.
1. `REHEARSAL_SITE_TOKEN`: private hosting access token.
1. `REHEARSAL_APP_KEY`: application authorization key.

Use both headers on every API request:

```text
OAI-Sites-Authorization: Bearer <REHEARSAL_SITE_TOKEN>
Authorization: Bearer <REHEARSAL_APP_KEY>
```

Keep all credentials on the backend. Do not use `NEXT_PUBLIC_`, put tokens in
URLs, commit `.env.local`, echo environment values, or send credentials to the
browser. Document variable names only in `.env.example`. Do not regenerate or
rotate keys merely because a request fails.

Available model IDs:

| ID | Use | Result |
| --- | --- | --- |
| `lfm3` | `LFM3-1.7B` conversation and short reasoning | `text` |
| `gliner-base` | GLiNER2.5 entity extraction and advisory classification | `kind`, `spans` |

Seven additional checkpoints are downloaded but are not enabled. Do not claim
they can serve requests or enable them without testing their runtime support.

1. `GET /api/status` reports worker availability, enabled models, and expiry.
2. `POST /api/jobs` accepts `{request_id, model, prompt}` and returns `{id}`.
   Use a UUID as `request_id`; retain it when retrying the same submission.
3. Poll `GET /api/jobs?id=<id>` approximately every two seconds. Its `jobs` array
   contains the caller's matching request. Stop on `done` or `failed`.
4. On `done`, parse the job's `result` JSON string to obtain the model response.

The API serializes inference and permits 4,000 prompt characters, 3 pending
requests per identity, and 60 submissions per hour. LFM output is capped at 256
tokens. Treat 401/403 as authorization errors, 409 as an ID/payload conflict,
429 as a rate limit, and 503 as unavailable service. A client timeout does not
cancel a queued job; poll its existing ID before submitting another.

All callers using the application key share one application identity and its
history. A multi user application must authenticate its own users and enforce
job ownership in its backend; never expose the shared history directly.
Dashboard members have separate histories tied to authenticated user IDs.

## Existing clients and tests

Reuse `rehearsal/hosted.py` for Python and `examples/hosted-models.mjs` for Node
backends. Both use the hosted API; neither requires SSH. The Python CLI loads
`.env.local`; library callers must load their environment before constructing
`HostedModels`. The Node module expects variables already in `process.env`.

Run from the repository root:

```sh
python3 -m unittest discover -s tests -v
python3 -m rehearsal demo
```

For a small live model test, first check availability, then use:

```sh
python3 -m rehearsal.hosted 'Suggest one question for a board chair.'
python3 -m rehearsal.hosted --model gliner-base 'Jeff will call IT before 3 PM.'
```

These live tests use the existing GPU service. Do not silently fall back to a
paid provider. Voice spending defaults to zero; retain that default unless the
user authorizes billable speech tests with a known price.

## GPU operations for authorized operators only

This section grants no Velocity login or SSH access. Ordinary application agents
use the hosted API above. Do not attempt cluster access unless the owner has
explicitly authorized this agent to administer that account.

Before any cluster access, read [GPU_ACCESS.d](../GPU_ACCESS.d). The existing service
uses job **20031**, GPU UUID **778d17bf-71bd-2cb7-51f6-d39f0ca2fee5**. Check live
Slurm status before GPU work; a dated assignment is not proof it still runs.
The allocation is scheduled to end **2026-11-08 15:46:25 UTC / 10:46:25 AM Toronto**.
After expiry, stop inference work until a valid allocation is authorized.

Remote working directory:
`/home/abehl/worldmodel/runs/boardroom-local-models-2026-11-07`

1. `rehearsal/gateway.py` serves authenticated inference on `127.0.0.1:8877`.
1. `rehearsal/queue_worker.py` polls the hosted queue using outbound HTTPS.
1. Gateway log: `logs/boardroom-gateway-web-20261107-1932.log`.
1. Worker log: `logs/boardroom-queue-fixed-20261107-1924.log`.
1. `queue-config.json` and `model-token` are private credentials; do not print them.
1. `queue-outbox.json` holds an undelivered completion. Preserve it during recovery
  to avoid regenerating completed work.

Reuse the running service. Do not start duplicate model servers or queue workers.
Coordinate any restart with other users of the shared allocation. Never kill
the allocation's original `srun` processes or `velocity` tmux session. Keep the
compute HTTP port private; the deployed API does not need an SSH tunnel or this
Mac to remain online. Follow the detached step and resource rules in GPU_ACCESS.d.

## Implementation boundaries

1. `rehearsal/core.py` owns the experimental demo state and requires human chair
  confirmation. The production game instead follows the confirmed voting and
  CEO tie rules in [backend-spec.md](backend-spec.md). Models never confirm either.
1. Keep model calls outside state transactions so timers and queues remain responsive.
1. Treat classification and mood related interpretation as advisory. Do not infer
  authoritative emotional profiles. Preserve evidence spans and disagreement flags.
1. Only finalized transcripts enter authoritative history. Characters must see
  only their permitted context; never leak unreleased scenario facts.
1. Keep speech cancellation, idempotency, and evidence linked decision snapshots.

The hosted dashboard/API source is `sites/rehearsal-lab`. Its registered project
ID is in `.openai/hosting.json`; reuse it and preserve the three member audience.
Follow the Sites skill when changing or publishing that site. Use schema
migrations for D1 changes. Keep worker credentials separate from application
credentials, preserve server authorization, and never trust client supplied owners.

After changes, run relevant tests and report what was verified. Distinguish
downloaded weights from enabled models and successful HTTP checks from visual
browser checks. Report running GPU services when finishing; do not release the job.
