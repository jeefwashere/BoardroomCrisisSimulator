# Vultr CPU hosting and GoDaddy domain plan

Status: proposed deployment procedure, not a deployed service. Written on 8 November 2026 for branch `vultr`, based on committed `test-ui` revision `2e3d5314a52cde3d4868def9053232b9941d1228`. This change publishes documentation only. No Vultr resource, DNS record, certificate or provider credential has been created or changed.

## 1. What we will use Vultr for

Use one Vultr Cloud Compute CPU instance for the initial shared test. It will serve the built React website, deliver the 3D assets, run the FastAPI game backend, retain approved private recordings and usage ledgers, and call the existing Google Vertex and ElevenLabs services. GoDaddy will manage the domain and, if its nameservers are authoritative, the DNS records pointing to Vultr.

A proposed starting size is 2 vCPUs and 4 GiB RAM for a small test group. This is a sizing estimate, not a load tested capacity or purchased plan. Confirm region, disk capacity, transfer allowance and current price before provisioning. Build the frontend in CI or on the development machine if the build needs more memory than the runtime server.

The 3D boardroom renders on each visitor's device using Three.js, WebGPU where available and its WebGL2 fallback. The CPU server delivers files; it does not render and stream video frames. A Vultr GPU is not required for this web application. Local LLM hosting, TRELLIS generation and Blender baking are separate future workloads, not part of this upload. No Velocity access is required by players.

[Vultr's product documentation](https://docs.vultr.com/products) describes Cloud Compute, Object Storage and CDN as separate services. Exact prices are intentionally not quoted here.

## 2. How the 3D assets are stored now

The files are tracked directly in Git under [my-app/public/models](../my-app/public/models). They are not stored in a database or a remote bucket, and this branch does not configure Git LFS for them.

| Path under `my-app/public/` | Contents | Approximate size |
| --- | --- | --- |
| `models/characters/` | Three character GLBs and one shared animation GLB containing four animation clips | 3.85 MiB |
| `models/props/` | Ten object GLBs and `props.json` | 7.01 MiB |
| `models/room/` | Baked room GLB and `room.json` | 2.99 MiB |
| `textures/sky/skyline.jpg` | Separate panoramic background | 1.22 MiB |

There are 15 GLB files. Inspection found no external buffer or image URI in these GLBs. Keep the separate skyline image and JSON metadata with the models. All public assets together are approximately 15.14 MiB at the inspected revision; this is not the full JavaScript build, decoded GPU memory requirement or total server disk usage.

[Boardroom.ts](../my-app/src/features/boardroom3d/Boardroom.ts) loads models from `import.meta.env.BASE_URL + 'models/'`. Vite copies `public/` files into `dist/` without changing their names, so the deployed room URL is `/models/room/room.glb`. See [Vite public asset documentation](https://vite.dev/guide/assets).

The exported runtime assets are included. The room metadata references `game-ui/tools/build_room.py`, which is absent from this branch. Hosting the scene is covered; reproducing its Blender authoring and baking pipeline requires locating the source scripts and original assets separately.

## 3. CPU server upload contents and layout

Here, CPU upload means deploying the application and its files to a normal CPU virtual machine. It does not mean uploading GPU model weights.

Use this proposed layout:

```text
/srv/boardroom/app/                  checkout of the published vultr branch
/srv/boardroom/app/my-app/dist/      public frontend build and 3D assets
/srv/boardroom/app/backend/.venv/    Linux Python environment created on the server
/var/lib/boardroom/                 private recordings, caches and usage ledgers
/etc/boardroom/backend.env          backend secrets and runtime settings
/etc/caddy/Caddyfile                HTTPS and reverse proxy configuration
```

1. Upload or clone the committed repository, including `backend/`, `scenarios/`, `rehearsal/` and the required `playtest/` modules, fixtures and recorded MP3 assets. The current backend imports shared code from `playtest/vertex.py` and reads the recorded catalog; uploading `backend/` alone is insufficient.
2. Build and upload `my-app/dist/`, including `models/`, `textures/` and other public files. A build created on another machine must use the final public API origin before upload.
3. Create the Linux Python environment from `backend/requirements.txt`; do not copy a Mac virtual environment or `node_modules` to Linux.
4. Configure only the required backend credentials through a private environment file. Do not put secrets into `dist/`, any `VITE_*` variable or Git.
5. Keep private recordings and persistent usage ledgers outside the public web root. Move only approved existing data, preserving ledger history. Do not reset spending counters as part of deployment.
6. Keep the existing local service running until the hosted test passes. No current user room is migrated by copying source files.

Example build and startup commands, to run later after provisioning, dependency installation and configuration:

```sh
# From a checkout on the CPU server, with Node compatible with the lockfile.
cd /srv/boardroom/app/my-app
npm ci
VITE_API_BASE_URL=https://example.com npm run build

# From the repository root, with a supported Python version.
cd /srv/boardroom/app
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt

# The service environment must already contain the configured runtime values.
backend/.venv/bin/python -m uvicorn backend.app.main:app \
  --host 127.0.0.1 --port 8000 --workers 1
```

Replace `example.com` with the selected domain. `VITE_API_BASE_URL` is the origin, not an origin ending in `/api`, because the client appends `/api/...`. Do not use the local development default `http://127.0.0.1:8000` in the public build. The backend entry point is documented in [room-api.md](room-api.md).

Run the backend under a service manager, with working directory `/srv/boardroom/app`, a dedicated application user, `EnvironmentFile=/etc/boardroom/backend.env`, and the single worker command above. A proposed systemd service needs `Restart=on-failure` and write access to `/var/lib/boardroom`; this document does not install one.

## 4. Runtime configuration

| Setting | Planned value or responsibility |
| --- | --- |
| `BOARDROOM_ALLOWED_ORIGINS` | `https://example.com`; add another origin only if actually serving the app there |
| `BOARDROOM_SECURE_COOKIE` | `true` for public HTTPS |
| `GOOGLE_API_KEY` or `VERTEX_API_KEY` | Existing authorized Vertex credential, backend only |
| `BOARDROOM_VERTEX_ENABLED` | Explicitly enable the approved Vertex text path |
| `BOARDROOM_VERTEX_LEDGER` | Persistent path such as `/var/lib/boardroom/vertex/ledger.sqlite` |
| `ELEVENLABS_API_KEY` | Existing authorized speech credential, backend only |
| `BOARDROOM_TTS_ENABLED`, `BOARDROOM_TTS_VOICE_ID`, `BOARDROOM_TTS_VOICES` | Preserve the selected speech configuration and role voices |
| `BOARDROOM_TTS_LEDGER`, `BOARDROOM_TTS_CACHE` | Persistent paths outside the public directory |
| `BOARDROOM_RECORDINGS_DIR` | `/var/lib/boardroom/recordings` |
| `BOARDROOM_STT_ENABLED` | Enable only for the selected microphone transcription path |

Review [vertex_text.py](../backend/app/vertex_text.py), [narration.py](../backend/app/narration.py) and [recordings.py](../backend/app/recordings.py) for all required billing, rate and enablement settings. Preserve the user's existing authorization and usage records; the environment above is a configuration inventory, not a complete secret file or a new spending policy. Prepare directories and permissions before service startup. Merely creating a dotenv file does not load it into a systemd service; configure its `EnvironmentFile` explicitly.

## 5. GoDaddy DNS setup

The real domain and Vultr public IP have not been selected or supplied for this plan. `example.com` and `VULTR_PUBLIC_IPV4` are placeholders.

1. Open GoDaddy Domain Portfolio, select the domain and open DNS management.
2. Check its authoritative nameservers first. If DNS is hosted elsewhere, make these changes there instead of adding ineffective GoDaddy records. Keeping GoDaddy as registrar does not require moving DNS or buying its web hosting.
3. For the proposed apex domain setup, add or edit the following records:

| Type | Name | Value | Purpose |
| --- | --- | --- | --- |
| A | `@` | `VULTR_PUBLIC_IPV4` | Send the root domain to the CPU server |
| CNAME | `www` | `example.com` | Resolve the www name to the same service |

4. Use the available short TTL during initial rollout, for example 600 seconds if the UI offers it. Do not promise immediate propagation; cached records can remain until their previous TTL expires.
5. If the root domain already hosts another site, use an agreed subdomain instead, such as an A record named `rehearsal`. Update the build origin, allowed origins and HTTPS configuration to that hostname. Do not overwrite an existing website unintentionally.
6. Remove or replace only conflicting web records for the selected hostname. Leave MX, SPF, DKIM, DMARC and other unrelated records intact. Add AAAA only if IPv6 is configured and tested on the server; an obsolete AAAA can send some visitors to the wrong host.
7. This plan keeps the backend under `/api` on the same origin, so no `api` subdomain or separate API DNS record is required.

Official instructions: [GoDaddy DNS management](https://www.godaddy.com/help/manage-dns-records-680), [add an A record](https://www.godaddy.com/help/add-an-a-record-19238), and [add a CNAME record](https://www.godaddy.com/help/add-a-cname-record-19236).

## 6. HTTPS and request routing

Use Caddy as the proposed web server. Permit inbound HTTPS on 443 and HTTP on 80 for redirection and certificate validation; restrict SSH to the operator's access path. Keep Uvicorn on localhost port 8000. Domain DNS must point at the server before public certificate validation can succeed. Caddy manages certificate issuance and renewal, so a separately purchased GoDaddy SSL certificate is not part of this plan. See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

Illustrative Caddyfile, not installed or validated against a live server:

```caddyfile
www.example.com {
    redir https://example.com{uri} permanent
}

example.com {
    encode zstd gzip

    handle /api/* {
        reverse_proxy 127.0.0.1:8000 {
            flush_interval -1
        }
    }

    handle /models/* {
        root * /srv/boardroom/app/my-app/dist
        header Cache-Control "public, max-age=3600"
        file_server
    }

    handle /textures/* {
        root * /srv/boardroom/app/my-app/dist
        header Cache-Control "public, max-age=3600"
        file_server
    }

    handle {
        root * /srv/boardroom/app/my-app/dist
        try_files {path} /index.html
        file_server
    }
}
```

The proxy preserves the `/api` prefix and allows prompt flushing for streamed speech responses. Missing model files return a file error rather than the application's HTML fallback. Fixed asset names currently use a short cache lifetime; add versioned filenames or release directories before choosing long immutable caching. Confirm actual speech streaming in the browser; this sample is not a measured production configuration. See [Caddy reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## 7. Optional Object Storage and CDN

For the initial approximately 15 MiB public asset set, serve files from the same CPU instance. This avoids introducing a second asset origin solely for the current demo.

Later, Vultr Object Storage can hold models, textures and other intended public assets, with a CDN delivering them. It is a separate S3 compatible file service, not a replacement for the FastAPI process. See [Vultr Object Storage](https://docs.vultr.com/products/storage/object-storage) and [its security and CDN guidance](https://docs.vultr.com/platform/security-best-practices/vultr-object-storage).

That move needs an explicit asset base URL in `Boardroom.ts`, matching model, metadata and skyline URLs, correct CORS for the website origin, content types and cache versioning. It is not configured in this documentation change. Private participant recordings and uploaded incident documents must retain authenticated access; do not put them into a public asset bucket.

## 8. Current deployment limits and remaining work

1. Rooms, memberships and command receipts are held in process memory in [rooms.py](../backend/app/rooms.py). Use one backend worker. Restarting or replacing it loses active rooms; persistent audio files do not restore the game. Durable shared state is a separate implementation before using multiple workers or replicas.
2. The document upload and summary handlers in `my-app/dev/` are development and preview stubs. A static frontend build does not turn them into production document processing. Replace, explicitly disable or clearly scope these controls before advertising general document uploads. The included scenario's curated documents are a separate path.
3. The selected runtime uses hosted Vertex and ElevenLabs. No local model weight download or new GPU service is included in this CPU plan. Check the exact feature path before adding any optional embedding dependency.
4. This branch contains source and a deployment proposal, not a tested Linux image, installed service, live domain or uptime guarantee. Existing tests do not establish Vultr capacity or browser GPU compatibility.
5. Keep a recorded source commit and previous frontend release for rollback. Schedule backend upgrades between tests because rolling back the code also restarts the in memory service.

## 9. Deployment verification when execution is requested

1. Confirm DNS with `dig +short example.com A`, `dig +short www.example.com CNAME`, and a check for unexpected AAAA answers.
2. Validate the Caddyfile and service configuration before reload; inspect service status without logging secrets.
3. Confirm HTTPS and `GET https://example.com/api/health` succeed through the public origin.
4. Fetch `/models/room/room.glb`, each character, `animations.glb`, props metadata and the skyline. Check actual binary or image contents and hashes, not merely HTTP 200, because an HTML fallback can hide a missing asset.
5. Open the 3D boardroom on another computer. Check room rendering, avatar motion, missing asset requests and microphone permission over HTTPS.
6. Join the same meeting from three independent sessions and verify identities, turns and decisions. Test the solo mode separately.
7. Verify Vertex responses, ElevenLabs speech, private coaching and assessment, transcript retention and Stop behavior. Keep browser listening and provider tests distinct from mocked tests.
8. Verify that secrets and private recordings are not available through static URLs, and that members cannot fetch another member's private records.
9. Export any required test results before a planned restart. Confirm the documented room loss behavior until durable storage is implemented.

## 10. Inputs needed before actual deployment

The operator still needs the target domain or subdomain, the DNS authority, the selected Vultr region and CPU instance, its public IP, a confirmed hosting budget, backend credential provisioning, a recording retention policy and a maintenance window. These do not block publishing this plan. No account credentials or DNS changes are requested or performed as part of this documentation task.
