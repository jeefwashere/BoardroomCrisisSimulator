# Coolify deployment on Vultr

This prepares `jeefwashere/BoardroomCrisisSimulator`, branch `chore/vultr-deployment`, for an existing Vultr Cloud Compute instance running Ubuntu with 2 vCPU, 4 GB RAM and Coolify. It does not provision a server, install Coolify, change DNS or deploy anything automatically. Use an existing Linux Docker destination in Coolify. The deployment files must be committed and pushed to that branch before Coolify can fetch them; local uncommitted files are not available to Coolify.

## Deployment layout

```text
Browser HTTPS
  -> Coolify proxy: TLS and HTTP to HTTPS redirect
  -> frontend:8080: Nginx + compiled React assets
      -> /api/* -> backend:8000: FastAPI + Uvicorn, one worker
      -> /docs, /redoc, /openapi.json -> backend:8000
```

The frontend image builds with `npm ci` and `npm run build`. Nginx serves the resulting `dist` directory, including all existing designs and animations. Vite development and preview servers are not production servers. The backend image installs `backend/requirements.txt`, `ffmpeg`, the existing scenarios and the existing rehearsal speech adapter. Neither image contains environment files or provider credentials.

The backend command explicitly uses `--workers 1` and no reload. Keep exactly one backend replica. Rooms, authenticated sessions, command receipts and recording indexes live in process memory. Additional workers or replicas would split authority. Restarting or replacing this container ends existing rooms and invalidates their sessions. The mounted files and ledger survive; they do not provide room recovery or automatically restore recording playback access. Durable room recovery remains separate work.

## Coolify configuration

1. In the intended Coolify project and environment, choose New Resource and an existing Docker destination on the Vultr instance. Connect `https://github.com/jeefwashere/BoardroomCrisisSimulator` through its GitHub App, deploy key or public repository source, as appropriate. In Git Source, select `chore/vultr-deployment`, not `main`, and confirm the intended commit contains these files.
2. Choose the Docker Compose build strategy. Set the base directory to `/` and the Compose location to `/compose.yaml`. Save and load the Compose content. Keep both build contexts at the repository root; do not select `my-app/` as the base directory.
3. In the application's environment settings, enter the values listed below. These are application variables, not Coolify instance configuration. Mark provider credentials as runtime only, with build time disabled. Do not upload the entire development `.env` or put credentials in build arguments.
4. Under Domains, select the `frontend` service, HTTPS, your actual hostname and internal port `8080`. In versions with a single URL field, the equivalent is `https://boardroom.example.com:8080`. Visitors use `https://boardroom.example.com`, without `:8080`. Enable HTTP to HTTPS redirection. Do not assign a backend domain or publish backend port 8000. [Coolify Compose configuration](https://coolify.io/docs/applications/builds/docker-compose), [domain port settings](https://coolify.io/docs/applications/configuration/general).
5. The intended hostname must already resolve to the selected Vultr instance and its proxy must be reachable on ports 80 and 443 for HTTPS. Review that existing setup with your server administrator. These repository changes do not modify DNS, firewall rules or infrastructure. [Coolify domain requirements](https://coolify.io/docs/core/networking/domains).
6. Confirm the generated configuration retains the `recordings` and `voice` named volumes, health checks and one backend replica. Leave backend access on the private application network. Do not connect untrusted workloads to that network or expose it through another domain.
7. When an operator separately authorizes deployment, use Coolify's Deploy action and inspect the build and runtime logs. The commands in this guide are instructions, not evidence that deployment has been performed.

The containers bind only their internal ports 8080 and 8000. Coolify's existing proxy alone owns the server's public HTTP and HTTPS ports; do not add a separate host Nginx, another public proxy or host port mappings for these services. On the 2 vCPU, 4 GB target, keep the model service external and retain cached builds. If concurrent builds exhaust memory, use a supported custom Compose build invocation to build the services serially, retaining Coolify's generated project, file and environment arguments. Changing a build command is an operator action; no server setting was changed here.

## Temporary testing hostname

For a temporary hostname, use Coolify's generated testing domain on the `frontend` service and target internal port 8080. Set `BOARDROOM_ALLOWED_ORIGINS` to that exact public origin, without the internal port or a trailing slash. A generated `sslip.io` HTTP hostname can check routing, but does not validate this application's production Secure cookies or remote microphone access. Use an HTTPS hostname with a valid certificate for the complete call acceptance test. A subdomain or wildcard under a domain you control is suitable for temporary HTTPS validation. Keep the production Secure cookie setting enabled. [Coolify domain options](https://coolify.io/docs/core/networking/domains).

## Logs and connectivity

In Coolify, open the application's Deployments history, select the operation and open Deployment Logs to inspect image builds and Compose startup. Then open Runtime Logs or Logs and select `frontend` or `backend` to inspect that container. The backend should announce Uvicorn on `0.0.0.0:8000` with one worker; the frontend should run Nginx rather than Vite. The Compose health checks are defined in `compose.yaml`; do not replace them with a single application health page setting.

After an independently authorized deployment, use the public HTTPS hostname to check:

```sh
curl --fail https://boardroom.example.com/healthz
curl --fail https://boardroom.example.com/api/health
curl --fail https://boardroom.example.com/api/scenarios
```

The API health response must contain `"status":"ok"` and `"storage":"memory"`. Open `/docs` to confirm the API documentation passes through Nginx. In browser developer tools, verify API requests use the same public origin and contain the existing private tab session header where required. Never copy its value into an issue or log. A 502 generally needs backend health or network investigation; a 403 on a POST needs the exact public origin and forwarded scheme checked. A 501 on the documented preview routes is expected.

## Three tab multiplayer acceptance

1. Open the public HTTPS application in three separate tabs. Enter a distinct display name in each. Each tab must retain its own membership token; do not duplicate an existing tab's credential manually.
2. In the first tab choose Host. Copy its room code, then Join that same code in the other two tabs. Confirm all three tabs show the same three members.
3. As host assign valid roles, including exactly one CEO, select the scenario and timing profile, then Start. Confirm every tab enters the same game and its timer continues progressing.
4. Send a chat message from each tab. Verify each committed message reaches all three tabs once. During each participant's turn, submit a typed answer, finish the turn and verify the floor moves for all users.
5. Cast votes independently in all eligible tabs. Verify the shared result and progression. Refresh a tab during the running session and confirm it recovers the same member and current state, with no duplicate participant.
6. With browser microphone permission, record during your own speaking turn and play the saved original through the authenticated UI. Keep STT and TTS disabled for this acceptance pass unless paid speech was separately configured and authorized. A fourth, unjoined tab must not be able to retrieve that recording.
7. Reach the end screen and check retained contributions, decisions and any available feedback. An unavailable external model service may use the application's existing fallback; this does not prove a live provider round trip.
8. Test the three documented development preview controls. Each must show the production unavailable response, and no email may be reported as delivered. Record browser console errors, HTTP failures and the deployed commit before approval.

## Frontend restarts and safe redeployment

The dependency in Compose runs from frontend to backend for startup readiness. There is no backend dependency on the frontend, no shared process and no restart propagation. Restarting the existing frontend container leaves the backend container, rooms and timers running. Nginx also re-resolves backend service DNS after backend replacement.

If Coolify provides a component scoped restart, select only `frontend` and confirm the operation names that component. An application level Restart or Deploy can reconcile the entire stack. For an authorized frontend only operation when the dashboard has no component control, an operator may use the server terminal with the exact running resource's generated Compose file, environment file and project name:

```sh
# Obtain these exact values from the running Coolify resource. Do not guess.
: "${COOLIFY_PROJECT:?Set the existing Compose project name}"
: "${COOLIFY_COMPOSE_FILE:?Set the generated Compose file path}"
: "${COOLIFY_ENV_FILE:?Set the resource environment file path}"
docker compose --project-name "$COOLIFY_PROJECT" \
  --file "$COOLIFY_COMPOSE_FILE" --env-file "$COOLIFY_ENV_FILE" \
  restart --no-deps frontend
```

That restarts the already built frontend image. For new frontend source, use the normal reviewed deployment workflow or a supported component scoped rebuild; a restart alone does not rebuild assets. An operator who manages Compose directly can build `frontend`, then run `docker compose up -d --no-deps frontend` in that same generated resource context. Preserve Coolify's proxy labels and project identity. Do not run a second Compose project alongside the application. [Docker Compose service selection](https://docs.docker.com/reference/cli/docker/compose/up/).

For routine GitHub updates:

1. Review and test changes on `chore/vultr-deployment`, then commit and push normally when authorized. Do not merge into `main`, rewrite history or force push for this deployment workflow.
2. Before a release, record the last working commit, environment configuration and actual volume names. Retain an appropriate private backup of recordings and a consistent backup of the voice ledger. Never clear existing reservations.
3. In Coolify Git Source, confirm the branch remains `chore/vultr-deployment`. Keep automatic deployments disabled while an exercise is running. Schedule a maintenance window for any release that can replace the backend.
4. Select Deploy for the intended pushed commit. Check Deployment Logs, both component health checks and Runtime Logs. Full stack reconciliation can replace the backend and therefore end memory rooms even when the code change looked small. Do not add another backend replica to avoid downtime. [Coolify Compose update behavior](https://coolify.io/docs/applications/deployments/rolling-updates).
5. Repeat connectivity and three tab checks. Users must create new rooms after a backend replacement. Keep the same application resource and its volumes; do not delete and recreate the resource as a routine redeployment.

## Rollback after a failed deployment

For this Git based Compose application, use a reviewed source rollback as the reliable recovery path. Generic image rollback controls vary by deployment type; do not assume they restore this entire two image Compose stack. Coolify's documented registry rollback integration excludes the Docker Compose build pack. Image rollback also does not restore persistent state. [Coolify rollback limitations](https://coolify.io/docs/applications/deployments/rollbacks).

1. Capture the failed commit and deployment logs. Pause automatic deployments so they cannot immediately reapply the failed release. If the previous containers are still healthy, retain them while preparing the correction.
2. On `chore/vultr-deployment`, create a normal revert commit for the faulty deployment changes, or a reviewed corrective commit that restores the last working source and Compose configuration. Push normally; do not reset or force push the branch and do not deploy `main` as a shortcut.
3. Confirm the Coolify environment values remain compatible with that source. Restore intended variable values if they were changed, while keeping the same recording and voice volume mounts and ledger data. A source rollback must not delete a volume or reset spending reservations.
4. Deploy the corrective commit through the same Coolify application. Inspect both services' health and logs, then repeat the public HTTPS and three tab checks.
5. A replaced backend cannot recover its former in memory rooms. Inform users to create new rooms. If a release changed persisted data, use its separate data restore plan; a code rollback alone cannot undo that change.

## Current main integration

Game source is byte identical to main717b823. This branch retains Jeff deployment infrastructure and adds the current game runtime dependencies to the backend image: the shared Vertex provider, selected public participant packs, recording catalogs and audio, and the three incident PDFs. The controller reference stays excluded.

Configure `GOOGLE_API_KEY` or `VERTEX_API_KEY` as a backend runtime secret in Coolify and keep `BOARDROOM_VERTEX_ENABLED=true` when using Gemini. The Vertex ledger is fixed under the existing writable voice volume at `/data/voice/vertex/ledger.sqlite`. Existing ledgers and reservations must be preserved. `BOARDROOM_VERTEX_CAP_CENTS` and `BOARDROOM_VERTEX_UNLIMITED` remain explicit operator configuration; no new unlimited authorization is applied. Speech settings remain the original deployment defaults until configured by the operator.

Source checks pass, but this integration has not been deployed by this task and actual Docker image builds remain unverified on this workstation because its Docker engine is not running. See [integration evidence](evidence/main-vultr-integration-20261108.json).

## Environment variables

Start with [the deployment example](../deploy/production.env.example). Compose injects only the explicit backend allowlist. The frontend has no runtime secrets and uses relative `/api` URLs on the public origin. The application source remains identical to main, including its local development API default. The Docker build explicitly sets `VITE_API_BASE_URL` to an empty string so deployed browsers use the public origin. Changing the domain therefore requires no frontend API URL rebuild. Never put a provider key in `VITE_*`; Vite exposes those values in browser assets. [Vite environment handling](https://vite.dev/guide/env-and-mode.html).

| Variable | Required value or behavior |
| --- | --- |
| `BOARDROOM_ALLOWED_ORIGINS` | Required. Exact public origin, for example `https://boardroom.example.com`. Comma separate additional intended origins. Include the scheme, with no trailing slash, path or wildcard. This is the public origin on port 443, not the internal `:8080` routing port. |
| `FORWARDED_ALLOW_IPS` | Defaults to `*` only because the backend has no host port and accepts requests from the trusted Nginx application network. A known proxy IP or CIDR can narrow this further. Never expose the backend while trusting arbitrary forwarding headers. |
| `REHEARSAL_API_URL` | Existing hosted HTTPS model API, if AI integration is enabled. Use the current operator supplied URL and verify its health and allocation before a live exercise. Do not use `localhost`: inside this container it means the backend container. |
| `REHEARSAL_APP_KEY` | Existing model application credential. Backend secret. |
| `REHEARSAL_SITE_TOKEN` | Existing model site credential. Backend secret. |
| `ELEVENLABS_API_KEY` | Needed only for explicitly enabled paid speech. Backend secret. |
| `BOARDROOM_TTS_ENABLED` | `false` by default. Set `true` only when authorized speech is configured. |
| `BOARDROOM_STT_ENABLED` | `false` by default. Original audio storage and typed answers remain usable without transcription. |
| `BOARDROOM_VOICE_BUDGET_USD` | Defaults to `0`. Positive authorized cap required for paid speech. Keep existing ledger reservations. |
| `BOARDROOM_TTS_USD_PER_1K` | Defaults to `0`. Supply the verified price for the selected speech adapter before enabling TTS. |
| `BOARDROOM_STT_USD_PER_MINUTE` | Defaults to `0`. Supply the verified transcription price before enabling STT. |
| `BOARDROOM_TTS_VOICE_ID` | Existing authorized voice ID when TTS is enabled. |

Compose fixes `BOARDROOM_SECURE_COOKIE=true`, `BOARDROOM_RECORDINGS_DIR=/data/recordings`, `BOARDROOM_TTS_LEDGER=/data/voice/ledger.sqlite` and `BOARDROOM_TTS_CACHE=/data/voice/tts-cache`. Do not set `WEB_CONCURRENCY` or override the backend command to add workers. `LOCAL_MODEL_URL`, the managed agent ID and playground admin credentials are not needed by this backend deployment. The existing LFM3, GLiNER and ElevenLabs architecture is unchanged; the Compose file starts no models or workers for another service.

Coolify terminates HTTPS and sends the public scheme to Nginx. Nginx preserves the host and scheme, then overwrites forwarding headers at the backend boundary. Uvicorn enables proxy header support and reads `FORWARDED_ALLOW_IPS`. FastAPI's existing explicit origin checks and private tab header remain in effect. This prevents mixed content API calls and HTTP redirects from an HTTPS page. Microphone use requires the public HTTPS secure context and browser permission. [FastAPI behind a proxy](https://fastapi.tiangolo.com/advanced/behind-a-proxy/), [Uvicorn proxy settings](https://uvicorn.dev/settings/).

## Persistent private storage

| Named volume | Container mount | Contents |
| --- | --- | --- |
| `recordings` | `/data/recordings` | Original `.audio` files and associated persisted recording metadata. |
| `voice` | `/data/voice` | SQLite voice reservations, TTS cache and the existing STT adapter's `speech-cache` subdirectory. |

New volumes inherit private directories owned by UID/GID `10001:10001` from the backend image. That nonroot user runs Uvicorn with a `077` umask. Existing recording code also restricts directory and original file permissions. Neither volume is mounted into Nginx or served as static content. Audio access remains through the existing authenticated FastAPI routes. Temporary request buffers live in container tmpfs and are not public files.

Preserve and back up both volumes with the same Coolify application resource. Changing the project or resource identity may create new empty volumes; explicitly migrate the prior data when moving hosts. Never use `docker compose down --volumes` for an ordinary update. For an existing bind mount or restored volume, ensure the mounted directories and contents are writable by `10001:10001`, with private directory permissions, before starting the backend. Verify the ledger is the original file rather than a newly created empty ledger. Use a consistent SQLite backup or snapshot and retain reservation rows. These steps do not restore in memory room authority. [Coolify persistent storage](https://coolify.io/docs/services/configuration/persistent-storage).

## Development preview features that are unavailable in production

These routes exist only in `my-app/dev/` middleware registered by `vite.config.ts`. Vite's `configureServer` and `configurePreviewServer` hooks are absent from compiled static assets. The frontend controls remain present. Production Nginx returns an explicit JSON `501` response rather than pretending the feature succeeded.

| Route | Current development behavior | Production gap |
| --- | --- | --- |
| `POST /api/documents/process` | Validates and acknowledges up to five DOC, DOCX or PDF files, then discards them. | No real backend document processor or agent context ingestion endpoint exists. |
| `GET /api/rooms/{roomCode}/summary` | Returns a pending summary with an empty list. | No backend implementation for this preview contract. Real gameplay evidence and existing `/extras` feedback remain separate and available. |
| `POST /api/rooms/{roomCode}/summary/email` | Returns a preview receipt with `sent: false`. | No email provider or delivery implementation. No email is sent. |

When real backend implementations are added, remove the corresponding explicit `501` Nginx locations and route them through the normal API proxy. The existing upload client limits remain unchanged. Nginx allows 16 MiB for normal API request bodies, enough for the backend's 10,000,000 byte audio original encoded in JSON. The unsupported document route has a 110 MiB limit for the existing five file request contract. There are no authoritative gameplay WebSocket endpoints in this checkout; gameplay continues through its existing HTTP polling. A Compose deployment does not introduce WebSocket synchronization or durable storage for rooms.

## Validation before deployment

The example below contains placeholders only and can be used without reading development credentials:

```sh
docker compose --env-file deploy/production.env.example -f compose.yaml config --quiet
docker compose --env-file deploy/production.env.example -f compose.yaml build
```

On a machine with a running Linux Docker engine, inspect the built images without creating a public deployment:

```sh
docker compose --env-file deploy/production.env.example run --rm --no-deps frontend nginx -t
docker compose --env-file deploy/production.env.example run --rm --no-deps backend ffmpeg -version
docker compose --env-file deploy/production.env.example run --rm --no-deps backend python -c "import backend.app.main; print('backend import OK')"
```

The last two backend checks may create the named volumes; they make no provider calls. Image builds use the lockfile and pinned Python requirements. Base image tags receive upstream updates; record and pin reviewed image digests for a release if immutable rebuilds are required.

Run source checks from the repository root with the backend requirements installed. Recording tests also require `ffmpeg` on the validation host's PATH, even when provider calls are mocked; installing it in the image does not install it on your workstation:

```sh
python -m unittest discover -s backend/tests -v
python -m unittest discover -s tests -v
python -m rehearsal demo
cd my-app
npm ci
npm test
npm run lint
npm run build
```

After an authorized deployment, verify `/healthz`, `/api/health`, `/api/scenarios` and `/docs` over the public HTTPS origin. `/api/health` should explicitly report `storage: memory`. In two or three separate tabs, create and join a room, assign roles, start gameplay and verify shared progression and chat. Check the microphone permission prompt and an authenticated recording playback, without enabling paid transcription until authorized. Verify the three preview routes show clear production errors and email is never reported as delivered. Check that a nonmember cannot fetch recording audio, and that a foreign Origin POST is rejected. These are deployment acceptance steps, not checks performed against Vultr by this task.

## Preparation validation, November 8, 2026

Validation used the current Windows checkout based on `224669e`, now on `chore/vultr-deployment`, without deploying or changing a running service. Frontend and full backend source test results below are retained from the immediately preceding preparation run because that source is unchanged in this documentation follow up. Compose and the four proxy tests were checked again after the restart configuration update.

| Check | Result |
| --- | --- |
| Compose configuration | Passed with the placeholder environment example. Also verified two services, one backend replica, private volume mounts, no published backend port and no frontend provider environment. |
| Frontend production build and lint | Passed. |
| Frontend test suite | All 121 passed. |
| Production transformed API client | Verified same origin routing without a configured base URL and retention of an explicit override. |
| HTTPS proxy and CORS regressions | All four passed. An internal HTTP request with public Host and forwarded HTTPS produced Secure cookies and HTTPS redirects, admitted valid private tab authentication and rejected foreign origins. |
| Backend source layout | Import of the image's copied modules, scenarios and existing speech adapter passed in an isolated directory. |
| Local health and follow up configuration | The existing API returned `status: ok` and `storage: memory`. Updated Compose parsing confirmed one backend replica, no public host ports, and frontend restart independence. The live endpoint check does not verify a container build or public HTTPS. |
| Full backend suite | 152 of 157 passed. Four existing recording tests fail because this host lacks `ffmpeg` on PATH. One existing scenario symlink test errors with Windows privilege error 1314. The Dockerfile installs `ffmpeg`; the unchanged tests must be rerun on the Linux validation host. |
| Prototype suite and authored demo | Demo passed. 30 of 31 prototype tests passed; the existing private file mode assertion fails on Windows because the platform reports 0666 rather than 0600. |
| Docker image build, Nginx syntax and container runtime | Unverified. The image build was attempted but the local Docker engine pipe was unavailable. Docker CLI installation and successful Compose parsing do not prove that images build or containers run. |

The Linux container checks and public HTTPS, microphone, persistence and multiplayer acceptance steps above remain required before production use. No paid provider request was made during preparation.
