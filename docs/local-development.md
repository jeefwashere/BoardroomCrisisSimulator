# Local development

The initial local runtime was verified from `main` commit `affa5db7b66a0606bb51291e3579025a81f7ad93`, which includes PR 11. Read the active source commit and process IDs from the ignored `.local/local-dev/processes.json` and PID files, and verify them against the running processes after each restart. This guide covers the local development runtime only. Frontend room flows and the full multiplayer connection remain separate work under I04.

## Open the application

1. Frontend: http://127.0.0.1:5173/
2. FastAPI documentation: http://127.0.0.1:8000/docs
3. Health: http://127.0.0.1:8000/api/health

Both servers bind to `127.0.0.1`. Keep that hostname consistent when testing browser membership. Speech is explicitly disabled with `BOARDROOM_TTS_ENABLED=false`. No paid provider or hosted model is needed for this local runtime.

Edit frontend source under `my-app/src/` to use Vite HMR. Edit Python source under `backend/app/` to restart the FastAPI application automatically. The backend watches only that source directory, so its logs and local evidence cannot cause a reload loop. Scenario data changes outside that directory need a backend restart.

There is one active backend application worker, supervised by the development reloader. All rooms and membership state live in that worker's memory. Every backend reload or restart discards them. Frontend HMR does not itself restart the backend.

## Current processes and logs

At verification on November 7, 2026 at 22:44 UTC, the frontend PID was `58922`, the backend reloader PID was `58923`, and its application worker PID was `59054`. The worker PID changes on reload. The services were launched as detached process sessions and remained reachable from subsequent independent commands.

The ignored `.local/local-dev/` directory contains `frontend.pid`, `backend.pid`, both log files, and `processes.json`. The JSON records the original launch, exact commands, owner thread, and verified worker PID. Treat it as a snapshot after later manual restarts. The PID files below are refreshed by the restart commands.

Inspect the recorded processes before stopping them. Stop only these project processes:

```sh
cd /Users/gz/BoardroomCrisisSimulator
ps -p "$(cat .local/local-dev/frontend.pid)" -o pid=,command=
ps -p "$(cat .local/local-dev/backend.pid)" -o pid=,command=
kill -TERM "$(cat .local/local-dev/frontend.pid)" "$(cat .local/local-dev/backend.pid)"
```

Stopping the Uvicorn reloader also stops its application worker. Do not use broad process name matching.

## Restart

If dependencies are absent, install from the existing lock files without upgrading packages:

```sh
cd /Users/gz/BoardroomCrisisSimulator
npm ci --prefix my-app --no-audit --no-fund
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

After stopping the old services, start the backend from the repository root:

```sh
cd /Users/gz/BoardroomCrisisSimulator
mkdir -p .local/local-dev
nohup env BOARDROOM_TTS_ENABLED=false BOARDROOM_SECURE_COOKIE=false \
  backend/.venv/bin/python -m uvicorn backend.app.main:app \
  --host 127.0.0.1 --port 8000 --reload --reload-dir backend/app \
  > .local/local-dev/backend.log 2>&1 < /dev/null &
echo $! > .local/local-dev/backend.pid
```

Start the frontend from the app directory:

```sh
cd /Users/gz/BoardroomCrisisSimulator/my-app
nohup node node_modules/vite/bin/vite.js \
  --host 127.0.0.1 --port 5173 --strictPort \
  > ../.local/local-dev/frontend.log 2>&1 < /dev/null &
echo $! > ../.local/local-dev/frontend.pid
```

If a port is occupied, inspect its owner before changing anything. `--strictPort` makes the frontend fail visibly rather than silently choosing a different URL. Review the local log files for startup failures.

```sh
curl --fail http://127.0.0.1:5173/
curl --fail http://127.0.0.1:8000/api/health
curl --fail http://127.0.0.1:8000/docs
```

## Verified behavior and remaining work

1. HTTP requests to the frontend, API documentation, and health endpoint returned 200. Health returned `{"status":"ok","storage":"memory"}`. The existing Python environment passed `pip check`, and the frontend dependencies installed with `npm ci` from the app lock file.
2. An actual Chrome page observed a temporary Home text marker through a Vite `js-update` frame. A window sentinel survived and the document did not navigate. The original text returned after restoration. Original source bytes and SHA256 were identical afterward, and the probe files had no Git diff.
3. A harmless mtime touch of `backend/app/main.py` replaced worker PID `58925` with `59054` while reloader PID `58923` stayed alive. Health returned 200 afterward. The Python source bytes and SHA256 stayed unchanged.
4. Local evidence is in `.local/local-dev/hmr-verification.json` and `.local/local-dev/backend-reload-verification.json`. The task owned browser target was closed and its exact lease released. The HTTP servers remained running at that initial verification.
5. These checks verify local automatic updates. They do not verify frontend room API integration, gameplay WebSockets, microphone capture, transcription, paid speech, complete multiplayer play, cloud hosting, or durable state. I04 remains unchecked.

[Vite documents its development server and HMR](https://vite.dev/guide/). The installed Uvicorn CLI was checked with `backend/.venv/bin/python -m uvicorn --help` for `--reload`, `--reload-dir`, and the worker restriction. [Uvicorn documents development reload settings](https://www.uvicorn.org/settings/#development).
