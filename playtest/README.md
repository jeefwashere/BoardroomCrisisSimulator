# Local AI and voice playtest

This isolated experiment adds a minimal FastAPI browser application on branch `experiment/ai-voice-playtest`. It does not replace Ricardo's `backend/app`, Jeff's frontend, or the shared model lab. Production task states and ownership are preserved.

Use [the manual test guide](TEST_GUIDE.md) for copyable T01, T02 and T03 questions, expected evidence, the agent roster, the five minute procedure and a results sheet.

## Single window meeting lab

Open <http://127.0.0.1:8788/meeting> for the requested meeting style UI. One window owns three explicitly labelled test memberships. Click Run 90s scripted demo to create a fresh room, submit three scripted contributions and prepared votes, and automatically request simultaneous character reviews after the round. The local model replies are live; scripted seats are not autonomous AI participants. Click a seat to control it manually, or use Start manual round with either the 90 second mechanics profile or the normal five minute profile. The short profile has a clearly labelled 15 second ballot. The normal profile retains 60 seconds.

The page displays actual model request timings, cited replies, manual quality review fields and a JSON export. Total time includes hosted queue, network and polling. The shared worker does not run three large models in parallel. Post round character review requires an ended room and an explicit review request. Optional voice controls use the same persistent speech ledger; the demo does not generate speech automatically. Provider keys remain on the backend. This is a meeting style test interface, not video conferencing.

The measurement and quality findings are in [the meeting evaluation report](MEETING_REPORT.md). Run `python -m playtest.meeting_benchmark` with an online local model service to repeat the text evaluation. Its `--resume-round` option preserves saved preparation results after an interrupted harness run and starts a fresh room for the round. `python -m playtest.meeting_voice_benchmark --allow-paid-speech` explicitly opts into the short speech round trip under the existing shared cap.

## Start it

Use Python 3.12 or newer. The existing backend dependency lock is reused.

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r playtest/requirements.txt
.venv/bin/python -m playtest --env-file .env.local
```

Open <http://127.0.0.1:8788>. Create a room and use **Open another seat** twice. Each new tab has its own member credential. Enter three distinct names, select roles, save the roles, and start. Refresh preserves the same seat within its tab. For this local test, start with `--allow-name-rejoin` to reclaim an inactive seat using the same name and room code. Click Leave this tab for immediate rejoin; after closing a window, wait 30 seconds. The member ID, role, contributions and ballot remain unchanged, and the old credential is revoked. An active seat cannot be reclaimed. This flag is disabled by default and does not change production authentication.

The playtest now runs exactly one MapleCart round. The default profile runs for five minutes from Start: 15 seconds briefing, 30 seconds reading, 135 seconds discussion, 60 seconds voting, then up to 60 seconds for a consequence, any tie or custom outcome handling. Prepared outcomes remain visible until the five minute deadline. Model failure can end with an explicitly unresolved action. The host can also select an approximately 6 or 7 minute round with a full 60 second vote. The explicitly labelled accelerated test profile uses 8 second votes and shorter speaking windows. It tests mechanics, not human rehearsal timing. Late arrivals become eligible at the next round boundary. The current electorate and CEO remain unchanged.

For the owner's authorized 10,000 credit speech test, the current separate worktree can run with:

```sh
.venv/bin/python -m playtest \
  --env-file ../BoardroomCrisisSimulator/.env.local \
  --speech-credit-cap 10000 \
  --allow-name-rejoin
```

The application binds only to localhost. The URL on one laptop does not grant access from another laptop. This branch is not a public deployment. Ordinary application users do not need Velocity or ChatGPT credentials: the application backend calls the existing hosted model API. A later shared application deployment needs its own authenticated ingress, configured origin policy, and durable process lifecycle. Do not expose this development server publicly as a shortcut.

## Credentials and storage

Configure `REHEARSAL_API_URL`, `REHEARSAL_SITE_TOKEN`, `REHEARSAL_APP_KEY`, and optionally `ELEVENLABS_API_KEY` in an ignored environment file on the server. Existing `rehearsal.adapters.load_env` reads that file without executing it. No provider keys enter JavaScript, HTML, URLs, exports, or Git.

Member tokens live in `sessionStorage` and authenticate each HTTP action. The server validates membership, the active phase, the roster, and the host or CEO permission. A display name is not production proof of identity. The explicitly enabled local test rejoin flag permits recovering only an inactive seat by name and room. Provider jobs are scoped to the member's room; shared provider history is never exposed.

The application uses one process and one worker. Rooms, credentials, command receipts, and agent jobs live in memory. Browser refresh works while that process lives. Restarting the backend loses rooms. The ignored `.local/ai-playtest/` directory stores the persistent speech credit ledger and cached generated audio. Temporary uploaded recordings are deleted after transcription. ElevenLabs retention follows the provider account policy; this application does not claim provider zero retention.

## What can be tested

1. Three to thirty independent participants, unique names, host role assignment, exactly one CEO, and an immutable round electorate.
2. Public preparation documents, briefing, timed reading, ordered speakers, finish or skip, open discussion, and an overall deadline.
3. Typed or reviewed speech contributions and one editable custom proposal per participant during discussion.
4. Private equal ballots, replacement before the deadline, full voting windows in real profiles, CEO selection among tied leaders, and authored no decision outcomes for abstention or tie timeout.
5. One authored MapleCart decision round with bounded meters, an applied consequence, and a final factual history. The communication and recovery rounds do not run in this test.
6. LFM3 mapping of the winning custom action to an allowed outcome. Output must contain only `outcome_id` and `explanation`; code applies the authored metrics and next node. Invalid or late results do not change a decision. One explicit retry is available within the original 30 second resolution window, only after the earlier provider job settles. Failure stays visible and ends with an unresolved action.
7. Facilitator, IT character, and journalist replies selected by LFM3 from currently released evidence. The published wording is authored evidence, which prevents invented facts and prevents future outcome leakage. These roles are intentionally narrower than unrestricted conversation.
8. GLiNER extraction from a selected committed contribution. Exact offsets and source text are validated. Extracted owners, deadlines, relations, and classes remain suggestions. Mentioning an owner does not record acceptance.
9. A deterministic decision checker, observed participation counts and question counts, and an optional LFM3 selection of authored debrief reflections tied to committed history. No emotional, personality, competence, or psychological scoring is produced.
10. Explicit ElevenLabs audio generation, single device playback leases, shared cancellation, short microphone or WAV transcription, editable provisional text, and explicit contribution commitment.

The eight logical responsibilities map to authored preparation, LFM3 facilitation, LFM3 evaluation plus factual fallback, code turn coordination, GLiNER tracking, code timekeeping, code decision checking, and observational climate feedback. They do not require eight independently loaded models. Only `lfm3` and `gliner-base` are enabled. No OpenRouter, commercial LLM fallback, or legacy managed ElevenLabs mood agent is used.

## Voice and the credit cap

Speech defaults to zero credits. The user authorized up to **10,000 ElevenLabs credits** for this test build. The server refuses a configured cap above 10,000. All rooms share a SQLite reservation ledger. Restarting with the same ledger does not reset spending or increase its stored cap. Do not delete the ledger, move to another data directory, or run independent ledgers to bypass that shared cap. A ledger first initialized at zero remains disabled; an operator must deliberately provision a separately authorized ledger to change that initial setting.

Rates were checked against [ElevenLabs pricing](https://elevenlabs.io/pricing) on November 7, 2026. Flash API speech costs up to one credit per character; the application reserves one credit per character and selects only a standard premade voice. Speech recognition is listed at approximately 330 credits per minute. The application conservatively reserves 400 credits for each clip of at most 30 seconds, including a full minute minimum. No enhanced transcription options are requested. This is an application reservation limit based on those rates, not a change to the account's provider billing settings or an exact invoice.

Reservations happen before billable requests and are atomic across concurrent callers. Failed or uncertain calls remain reserved. Requests are not automatically regenerated. Repeating a media command ID returns its original receipt or pending status. TTS is additionally cached by text, voice, and model. Cached playback makes no new generation call. Keep the ledger and cache together.

Microphone access requires a browser permission and an explicit click. Recording stops after approximately 29 seconds. Audio is local until **Transcribe recording** is clicked. Uploaded WAV files must be at most 30 seconds and 4 MB at the HTTP boundary. The response is provisional: edit it and click **Commit contribution** during an eligible speaking window. The speech API alone cannot create a contribution or vote.

Generated audio is limited to 500 characters. Captions are the exact generated portion. Press Play explicitly; there is no autoplay assumption. Only the requesting device may fetch the leased audio. Other members may stop it. A phase change, speaking turn change, expiry, or cancellation invalidates the lease. The browser polls for interruption; cancellation latency is approximately one polling interval. This is turn based speech testing, not a live voice conference or continuous streaming transcription.

## Scenario and protocol boundaries

The immutable authored MapleCart v2 package supplies the scenario, including its updated 30 seat capacity. The branch includes the latest production Start delivery from `main` at `b5d6fcb`; the experiment remains a separate application. Only the current situation, public documents, visible choices, and already committed history reach clients. Outcomes and custom rubrics stay on the server until the applicable decision.

T01, T02, and T03 participant documents are now in the Scenario reference library and available to the LFM3 preparation role. Their full timed branches are not playable game modes: they use two eligible votes plus chair confirmation, which differs from the selected production majority and CEO tie policy. Arbitrary document ingestion, streaming audio, WebSocket delivery, long term recovery, shared Internet hosting, and the seven downloaded but disabled models remain outside this test build. One second polling supplies the minimal UI.

The independent HTTP contract is documented by the executable clients in `smoke.py` and `voice_smoke.py`. It intentionally does not claim compatibility with Ricardo's cookie based lobby or Jeff's Start payload. Production integration should port the tested rules and provider boundaries into their agreed modules after review.

## Verification commands

```sh
.venv/bin/python -m unittest discover -s playtest/tests -v
.venv/bin/python -m unittest discover -s backend/tests -v
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m rehearsal demo
node --check playtest/static/app.js
.venv/bin/python -m pip check
```

With the server running, the default HTTP smoke exercises three clients without calling a model or speech provider:

```sh
.venv/bin/python -m playtest.smoke
```

First check `/api/health` for the worker's live status and allocation expiry. Then opt into the existing local models:

```sh
.venv/bin/python -m playtest.smoke --live-models
```

The explicitly paid speech smoke requires an enabled server credit cap and an existing `ffmpeg` executable. It generates fictional speech, decodes six seconds to WAV, sends it through the application transcription endpoint, verifies that it is provisional, and commits the returned text through a separate explicit command. This automated test does not claim a human reviewed the transcript. It waits for the real discussion phase and does not advance the server clock.

```sh
.venv/bin/python -m playtest.voice_smoke --allow-paid-speech
```

Reports go to ignored `artifacts/`. These HTTP checks do not establish human microphone capture or visual browser quality. The current hosted GPU allocation ends November 8, 2026 at 15:46:25 UTC, which is 10:46:25 AM Toronto. The app remains usable for authored play when models are unavailable; custom outcomes and AI feedback explicitly report failure. This branch does not start, stop, or release any GPU job.

An observed live quality failure shaped the final debrief boundary: unrestricted LFM3 prose incorrectly described an exported minimum as a final scope and treated a breach detail as a strength. The final implementation therefore lets LFM3 select authored, evidence linked reflections and publishes their exact wording. It does not publish unrestricted debrief prose.

## Three window text testing

Open three separate Chrome windows at <http://127.0.0.1:8788>. Create a room as Test 01, then join its code as Test 02 and Test 03 in the other windows. Each window stores its own member credential; there is no shared identity selector. Window titles show the active name and room code, and People lists each public member ID. Do not duplicate an existing authenticated tab, since browsers may copy its session storage; use a fresh window instead.

**Room text chat** works in the lobby, during speaking and voting, and after the exercise. Messages are authenticated as the sending window's participant and shared only within that room. Chat never casts a ballot, commits a decision, or changes the timed contribution history. Use **Timed contribution** for official discussion entries during your turn, and **Ask the local agents by text** for model replies. Text chat does not use ElevenLabs or consume speech credits. Press Ctrl+Enter or Command+Enter in the chat field to send.

## Current agents and one round test procedure

1. Preparation uses LFM3 to select relevant clauses from the chosen T01, T02, or T03 participant reference pack. Open the Scenario reference library while in the lobby, choose a pack, and ask a question. Responses cite exact source clauses. The original external reports remain source links in the imported guide; their complete PDFs and webpage text have not been indexed by this feature.
2. Facilitator, IT, and journalist are logical roles sharing LFM3. They can answer opening scenario preview questions in the lobby, before Start. During the exercise they see only released MapleCart evidence. Type a question and click Ask Facilitator, Ask IT character or Ask Journalist; Enter asks Facilitator. The panel shows sending, queued, completed and failed request status. Extraction requires a committed timed contribution, and debrief requires the exercise to have ended; the panel explains both prerequisites. A reference question about another pack cannot change that session's facts.
3. Custom decision evaluation uses LFM3 to select an allowed authored outcome for the winning custom proposal. The backend applies its consequence. The debrief uses LFM3 to select authored reflections based on the actual single decision.
4. Discussion tracking uses GLiNER2.5 Base for exact text spans such as names, actions, and deadlines. It cannot create an accepted task or decision.
5. ElevenLabs Scribe v2 transcribes short optional recordings; Flash v2.5 speaks approved text. There is no managed ElevenLabs conversation agent controlling the game.
6. Preparation documents, turn coordination, timekeeping, decision checks, and participation observations also have deterministic code responsibilities. Logical roles are not eight model instances.

For the requested human test, join with three different windows, leave the five minute one round timing selected in the host window, and start. Send room chat freely; submit timed contributions during each speaking turn. Vote once per user. A tied result goes to the CEO. After the one consequence is shown, the session ends with `round_complete`; click Generate debrief. The accelerated vote lasts eight seconds for mechanics checks only. Use the normal one round profile when testing human discussion and the full sixty second vote.

The original supplied revision is archived at `fixtures/revision2-controller-reference.md` for developer review. It includes hidden schedules and expected outcomes and is never served or read by participant retrieval. The explicit allowlist is `fixtures/participant-packs.json`; `references.py` reads only that file. No future invoice, candidate response, or expected test answer is in that public set. These fixture documents preserve the supplied wording; trailing whitespace in the archived Markdown is normalized.
