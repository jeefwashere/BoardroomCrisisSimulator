# Public three window demo over ngrok

This runs the T01 demo with three independent players: Alex, Morgan and Sam each use their own window, browser profile or device. Nothing is automated. Each player takes their own speaking turn, writes their own decision and answers their own coach. The room server tracks every turn.

## How it is wired

One ngrok address carries both the frontend and the backend:

* `scripts/ngrok-demo.sh` starts a Vite dev server with `my-app/vite.tunnel.config.ts` on port 5175, and points ngrok at it.
* That Vite server serves the app and forwards `/api` to the backend on `http://127.0.0.1:8000`.
* The app is built with an empty `VITE_API_BASE_URL`, so browsers only ever call the tunnel origin.
* The Host header and ngrok's `X-Forwarded-Proto` pass through unchanged. The backend's same origin check for POST requests therefore passes without adding the ngrok domain to its allowed origins.
* Microphone recording works because ngrok serves HTTPS.

Agent voice is generated once per room and line on the backend and shared, so extra windows do not repeat ElevenLabs calls.

## Start it

1. Start the backend, if it is not already running:

   ```sh
   python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir backend/app
   ```

2. From the repository root, start the tunnel:

   ```sh
   ./scripts/ngrok-demo.sh
   ```

   It prints the public address, the demo address (`<public>/#/demo`) and a login. Keep it running and press Ctrl+C to stop.

3. Your own local dev server on port 5173 keeps working and is not affected.

### Login

The backend can spend paid Vertex AI and ElevenLabs credit, so by default the tunnel asks for a login. It uses ngrok basic auth with a generated password stored in `my-app/.local/ngrok-demo/login`, which git ignores. Share the login with the other players.

* `NGROK_BASIC_AUTH=user:password ./scripts/ngrok-demo.sh` chooses your own login.
* `NGROK_BASIC_AUTH=off` removes the login, so anyone with the address can play.

The free ngrok plan shows a one time "You are about to visit" page; press Visit Site.

## Play the three window demo

1. **Alex (host):** open `<public>/#/demo`. Choose **Three independent windows**, pick the stage (3D boardroom or call tiles) and the voting options, then press **Create room as Alex**.
2. The next screen shows a join link for Morgan and one for Sam, with Copy and Open buttons. Send each link to its player, or open it in another window. Separate windows in one browser work, because each tab keeps its own membership.
3. **Morgan and Sam:** open the link and press **Join as Morgan** (or Sam). They wait in the lobby. They can also join from the home page with the room code, using the name Morgan or Sam.
4. When both show **Joined**, Alex presses **Start the game**. Roles are assigned as in the other demos: Alex is CEO, Morgan takes IT recovery and Sam takes communications. T01 Cedar Bridge starts and every window moves to its game screen.

Every window plays the agents' voice. If all three windows are on one computer, mute two of the tabs. The host's control bar keeps the host controls (Skip phase, End).

## Limits

* Rooms live in backend memory. Restarting the backend ends the game, and Alex's demo page returns to setup.
* A free ngrok account allows one agent at a time. The address changes on every start unless you use a reserved domain.
* Join links use the address Alex's page was opened on. If you open the demo on `127.0.0.1`, the page warns that the links only work on that computer.
