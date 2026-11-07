# Local AI and voice playtest

This isolated experiment adds a minimal FastAPI browser application on branch `experiment/ai-voice-playtest`. It does not replace Ricardo's `backend/app`, Jeff's frontend, or the shared model lab. Production task states and ownership are preserved.

## Start it

Use Python 3.12 or newer. The existing backend dependency lock is reused.

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r playtest/requirements.txt
.venv/bin/python -m playtest --env-file .env.local
```

Open <http://127.0.0.1:8788>. Create a room and use **Open another seat** twice. Each new tab has its own member credential. Enter three distinct names, select roles, save the roles, and start. Refresh preserves the same seat within its tab. Closing the tab loses that credential; entering the same name cannot reclaim someone else's seat.

The host can select the 15 or 18 minute profile with full 60 second voting. The explicitly labelled accelerated test profile uses 8 second votes and shorter speaking windows. It tests mechanics, not human rehearsal timing. Late arrivals become eligible at the next round boundary. The current electorate and CEO remain unchanged.

For the owner's authorized 10,000 credit speech test, the current separate worktree can run with:

```sh
.venv/bin/python -m playtest \
  --env-file ../BoardroomCrisisSimulator/.env.local \
  --speech-credit-cap 10000
```

The application binds only to localhost. The URL on one laptop does not grant access from another laptop. This branch is not a public deployment. Ordinary application users do not need Velocity or ChatGPT credentials: the application backend calls the existing hosted model API. A later shared application deployment needs its own authenticated ingress, configured origin policy, and durable process lifecycle. Do not expose this development server publicly as a shortcut.

## Credentials and storage

Configure `REHEARSAL_API_URL`, `REHEARSAL_SITE_TOKEN`, `REHEARSAL_APP_KEY`, and optionally `ELEVENLABS_API_KEY` in an ignored environment file on the server. Existing `rehearsal.adapters.load_env` reads that file without executing it. No provider keys enter JavaScript, HTML, URLs, exports, or Git.

Member tokens live in `sessionStorage` and authenticate each HTTP action. The server validates membership, the active phase, the roster, and the host or CEO permission. A display name is never proof of identity. Provider jobs are scoped to the member's room; shared provider history is never exposed.

The application uses one process and one worker. Rooms, credentials, command receipts, and agent jobs live in memory. Browser refresh works while that process lives. Restarting the backend loses rooms. The ignored `.local/ai-playtest/` directory stores the persistent speech credit ledger and cached generated audio. Temporary uploaded recordings are deleted after transcription. ElevenLabs retention follows the provider account policy; this application does not claim provider zero retention.

## What can be tested

1. Three to thirty independent participants, unique names, host role assignment, exactly one CEO, and an immutable round electorate.
2. Public preparation documents, briefing, timed reading, ordered speakers, finish or skip, open discussion, and an overall deadline.
3. Typed or reviewed speech contributions and one editable custom proposal per participant during discussion.
4. Private equal ballots, replacement before the deadline, full voting windows in real profiles, CEO selection among tied leaders, and authored no decision outcomes for abstention or tie timeout.
5. Three rounds of authored MapleCart consequences, bounded meters, carried facts, automatic progression, and a final factual history.
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

The three new fixture packs in the supplied revision use two eligible votes plus chair confirmation, conflicting with the selected production majority and CEO tie policy. They are not silently installed as alternative production game modes here. Arbitrary document ingestion, streaming audio, WebSocket delivery, long term recovery, shared Internet hosting, and the seven downloaded but disabled models remain outside this test build. One second polling supplies the minimal UI.

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
