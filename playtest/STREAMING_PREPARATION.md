# Live voiced meeting verification

Open <http://127.0.0.1:8788/>. One PDF is attached automatically. Load three test people, then use the CEO's Start meeting control. The preparation agent gives an introduction during a 30 second opening; the five minute discussion begins afterward. [The guide](ROUNDTABLE_GUIDE.md) explains the exact controls and a copyable decision test.

## Participant control and live agents

Each participant has a card with a current turn indicator and manual Play, Stop and Commit caption and pass controls. Only the current speaker can play their assigned existing recording. Nothing autoplays for the participants. The API exposes exactly three saved participant clips and rejects prerecorded agent clips or another participant's recording. A completed clip does not enter the transcript until the separate commit action. Typed and explicitly transcribed contributions also require that person's speaking turn.

The preparation agent, facilitator, IT adviser, journalist, decision guide and evaluation agent use live Gemini 3.8 Flash with LOW reasoning plus ElevenLabs Flash v2.5. Their speech is not taken from the saved clip library. Gemma retrieves only the room's PDF passages. Consultations also receive the recent discussion; evaluation receives the actual committed proposal, result and tally. The CEO chooses consultations during discussion or decisions. The decision guide asks what the group should decide, while the evaluation agent explains a result only after human votes and CEO confirmation.

The CEO can end discussion before five minutes. Decision guidance and quote based written minutes are requested once on entry to decisions. Each recorded result triggers a single evaluation request on the CEO screen. Persistent browser event markers and backend automatic request receipts prevent duplicate automatic charges for the same event. Manual new requests remain explicit.

The old `/audio-lab`, its scripts and styles, and `/audio-guide` routes now return 404. The three needed participant assets remain in use on the meeting page. Historical files and reports remain in the repository; they are not the current application navigation.

## Real streaming path

Gemini emits real SSE text deltas through Vertex Express. The server forwards them immediately and sends completed sentences to ElevenLabs' HTTP streaming endpoint concurrently. The browser receives 24 kHz PCM chunks and schedules each chunk with Web Audio. It does not wait for a complete speech file. Stop, turn changes, phase changes and disconnected clients cancel pending work and playback. A short response may finish writing before its first speech bytes arrive; the pipeline does not fabricate a typing delay to disguise that.

This implementation follows the official [Vertex streaming endpoint](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/express-mode/rest/v1/publishers.models/streamGenerateContent) and [ElevenLabs speech streaming endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/stream). Provider credentials stay on the backend.

## Live measured round

Three actual HTTP memberships completed room `HKWX6U`. The introduction produced **26.19 seconds of audio** inside a preparation phase measured at **30.08 seconds**. Discussion then received its 300 second deadline. The three saved clips were fetched in order, their real durations elapsed, and their captions were separately committed before advancing each turn. These checks establish byte delivery and turn timing, not that a human heard the audio.

The CEO consulted all three live advisers, ended discussion with **274.98 seconds remaining**, received a decision prompt, submitted a proposal about verifying backups before promising recovery, collected two approve votes and one reject vote, and committed the approved result. The evaluation correctly described the approved proposal and framed possible consequences as possibilities. It did not change the decision.

| Live role | First text | First audio | Audio duration | Audio before text finished |
| --- | --- | --- | --- | --- |
| preparation | 1.58 s | 2.65 s | 26.19 s | No |
| facilitator | 1.82 s | 2.03 s | 34.04 s | Yes |
| it | 1.37 s | 1.82 s | 29.72 s | Yes |
| journalist | 1.45 s | 1.99 s | 28.05 s | Yes |
| decision | 1.86 s | 2.19 s | 26.01 s | Yes |
| evaluation | 2.06 s | 2.52 s | 30.79 s | Yes |

All six live text and speech streams completed, as did the separate automatic minutes job. Five agent responses began speaking before Gemini finished writing. The short introduction finished its text at 2.03 seconds and began audio at 2.65 seconds, then provided a 26.19 second speech stream. Total time to the end of server delivery is different from browser playback duration.

Preparation accurately distinguished suspicious account activity from confirmed disclosure and kept unverified backup restorability explicit. IT preserved the three restoration prerequisites. Evaluation used the actual approved proposal. The decision guide offered interim coordination and paper appointments as alternatives even though they can be complementary; its suggestions remain advisory, and participants can write their own proposal. This is a small scripted smoke test, not a general accuracy or listening quality benchmark.

The full evidence is [the live round JSON](evaluations/preparation-stream.json). Local WAV captures are in the ignored `.local/ai-playtest/stream-verification` directory. Reproduce with `python -m playtest.preparation_benchmark --live`; the harness explicitly simulates manual clip fetch, elapsed duration and commit actions, and makes real provider calls.

## Warmup and cancellation

An initial development probe timed out while the local Gemma process was loading; no text or audio reached that HTTP client. Startup now warms the cached PDF reader before readiness permits Start. This keeps cold loading outside the timed introduction. The model loads once and is reused. Loading can still be slow under host load, so a fresh process may temporarily show the report as preparing. No checkpoint download, Vertex generation or speech request is performed by warmup.

Request bodies, queues, speech segments and response length remain bounded for responsive processing. These are resource and format limits, not spending caps. Agent wording is generated from evidence and may still be incomplete or mistaken. It never becomes a human contribution or an authoritative decision.

## Spending limits removed as requested

The user explicitly removed the app's credit and spending constraints after the live round. Both persistent ledgers now have `unlimited: true`; cap and remaining allowance fields are null. No application spending ceiling blocks Gemini or ElevenLabs calls. Usage accounting remains, including failed attempts, and no ledger was deleted or reset. This changes the application's checks, not the provider account plan.

The recorded totals at authorization were **8,713 conservative speech credit units** and **US$2.00 in Vertex reservations**, with all 78 speech rows and 40 Vertex rows retained. The successful full round itself added 2,931 speech units and US$0.35 in Vertex reservations. These are local accounting estimates, not an exact provider invoice. See [the preserved authorization and migration evidence](evaluations/unlimited-budget.json).

The explicit operator flag is `--unlimited-budget`. Its authorization persists across restarts using the same ledgers. Do not erase history, silently reintroduce caps, or substitute prerecorded voices for live agents.

## Verification boundary

The final checks passed 119 playtest tests, 31 existing tests and 16 Node UI tests. A parallel Node run hit wall clock timeouts under heavy host load; the sequential rerun passed all 16.

Automated Python checks cover readiness, permissions, exact phase timing, speaking turns, trusted recorded captions, source isolation, actual result context, cancellation, streamed provider parsing, audio chunk bounds and unlimited accounting persistence. Node tests exercise manual per participant controls, current turn labels, no participant autoplay, separate playback and commit, stale result rejection, PCM scheduling, partial network frames and automatic request deduplication.

The restarted server verified both unlimited ledger flags, one ready T01 PDF, exactly three participant recordings, working meeting routes and 404 responses for removed audio pages. Syntax, credential scanning, current documentation links, whitespace and the authored demo also passed.

Browser visual layout, actual speaker playback and human microphone permission remain manual checks. This task did not use computer controls. The server is still localhost only with test membership tokens and process memory rooms. It is published on the side branch, not merged into the production application. No Velocity service or teammate production module changed.
