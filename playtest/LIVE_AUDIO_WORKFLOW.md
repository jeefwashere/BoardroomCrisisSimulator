# Gemini Live private conversations

Current X23 adds [saved participant audio as Live input](RECORDED_LIVE_AND_SECTIONS.md). Use port 8791 and **Start Live with saved clips** to test without a microphone. The remaining X21 verification below is historical.

X21 adds an optional real time microphone conversation to the private coach in Round 2 and the same agent as examiner in Round 3. Working branch: `experiment/ai-voice-playtest`. The opening preparation agent, shared expert panel, saved participant clips, response cards, scoring and reunion remain available.

## Try it

1. Open [the Live test server](http://127.0.0.1:8791/roundtable) and create a fresh room. The earlier server on port 8788 stays running to preserve its rooms.
2. Load the three test members. Keep Beta test mode checked before the CEO starts. Complete Round 1 and submit each member's decision, then start private sessions.
3. Select Alex and wait for the current private question. Finish any existing speech or saved clip. Click Start Live with microphone and grant microphone access.
4. Gemini reads the current question and listens. Speak naturally. You can interrupt it; queued speech stops when the upstream interruption arrives. Use I finished speaking if you want to flush the current microphone turn.
5. Click Stop Live session. Choose Use recognized words as an answer draft. Remove conversational questions and correct recognition errors in the answer box. Confirm and submit separately.
6. The application advances to the next question. Start a new Live connection if wanted. Repeat for assessment, then select Morgan and Sam to test their separate branches.

Start explicitly opens the microphone. Stop, disconnection, leaving the page or changing the selected member/question releases it. Each connection lasts at most two minutes or eight model turns. These are resource bounds, not spending caps. Reconnect explicitly; no automatic paid retry occurs. The browser cannot submit a score or stage change through this socket.

## Models and data flow

Browser microphone → mono 16 kHz PCM → authenticated backend WebSocket → Gemini Live → 24 kHz PCM and provisional transcripts → browser.

The backend uses `gemini-3.8-live` with native Gemini speech and the fixed Kore voice. Live audio does not pass through ElevenLabs. The ordinary generated text and speech buttons still use Vertex Gemini Flash LOW plus ElevenLabs Flash v2.5; explicit recorded transcription still uses Scribe v2. The Speak with ElevenLabs setting controls that ordinary path; Start Live with microphone is a separate explicit microphone and native voice action.

Live receives the current member's original decision, their submitted private answers and response card, shared expert advice, and the existing room scoped PDF memory context. Other members' private coaching and assessment records are excluded. The current server question is authoritative. Documents and participant text are evidence, never new system instructions.

The coach can help reason about the current question. The examiner may repeat or clarify the question and acknowledge a response, but is instructed not to provide answers, evaluate correctness or reveal scoring feedback. No model tool can submit an answer, score it or advance the stage. Only separately reviewed assessment answers enter the existing scorer.

Transcripts are provisional and stored in that member's private session and written export. Raw microphone PCM is relayed and not saved by this application. Google receives the audio to process it. The single window test deliberately holds all three test identities; independent browsers remain membership scoped. Records are in process memory and disappear on restart, so export first.

## Repeatability

Beta mode sets temperature to zero, fixes the voice, uses the canonical server questions and approved twist, asks the model to read the current question verbatim and limits replies to 60 words. The app remains on the same question throughout each Live connection. Turn changes require human submission. Switch Beta off in the lobby to use temperature 0.3 and the existing adaptive question flow.

This improves repeatability without promising identical speech or wording. Recognition, voice timing, provider model updates and sampling can vary. Spoken instructions are model guidance; the server enforces submission, membership, revision and scoring boundaries. Live is optional, so the existing saved answers remain useful for repeatable beta tests. There is no supported LOW thinking setting for this Live configuration; LOW applies to the separate Flash text provider.

## Credentials, launch and cost

Store `GEMINI_LIVE_API_KEY` or `GEMINI_API_KEY` only in the ignored backend environment file. The existing Vertex Express `GOOGLE_API_KEY` is not reused for Live. The server rereads the dedicated key when connecting, so replacing it does not require restarting a meeting. Never put keys in browser JavaScript, socket URLs or committed files.

```sh
.venv/bin/python -m playtest \
  --env-file ../BoardroomCrisisSimulator/.env.local \
  --port 8791 --unlimited-budget --allow-name-rejoin
```

The declared WebSocket dependency is installed only in the existing virtual environment. Host and Origin checks restrict this localhost prototype. It does not create a public service or change Velocity access.

Google's Gemini 3.8 Live pricing checked November 8, 2026 lists audio input at $3 per million tokens, approximately $0.005 per minute, and audio output at $12 per million tokens, approximately $0.018 per minute. Text context is additional: $0.75 input and $4.50 output per million tokens. Three minutes of microphone input and two minutes of generated audio are approximately $0.051 before text context. See [official pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-live).

Existing unlimited spending authorization and ledger rows remain intact. Each bounded connection records a conservative $1 reservation and available upstream usage metadata in the existing local ledger. The reservation total is not actual provider billing. Native Live speech does not incur an ElevenLabs TTS call. Other exercise actions can still use the ordinary paid providers.

## Verification

Run the ordinary suites in [README](README.md). The opt in paid integration check is:

```sh
.venv/bin/python -m playtest.live_audio_benchmark --live --url http://127.0.0.1:8791
```

It creates a disposable room through HTTP, sends fictional recorded participant speech at real time speed, inspects input transcripts and output PCM, and verifies that stopping releases the member lock without submitting an answer. It does not operate the browser or establish listening quality. The observed results follow below.

References: [Live API guide](https://ai.google.dev/gemini-api/docs/live), [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [WebSocket protocol](https://ai.google.dev/api/live).

## Observed results on November 8, 2026

[The integration record](evaluations/live-audio-integration.json) contains a real coach and examiner connection using Alex's saved participant speech, with actual Gemma retrieval and Gemini text calls for the preceding exercise setup.

| Check | Round 2 coach | Round 3 examiner |
| --- | --- | --- |
| Recorded microphone input | 17.18 seconds | 20.25 seconds |
| First output PCM frame from connection start | 1.147 seconds | 1.147 seconds |
| Total nonempty PCM output | 27.53 seconds | 19.88 seconds |
| Recognized words match fixture after normalization | 45 of 45 | 48 of 48 |
| Answer remained unsubmitted | Yes | Yes |
| Member lock released on Stop | Yes | Yes |

The first frame latency measures the opening question, not response latency after a human finishes. Output includes the question and reply. The harness stops eight seconds after the recorded input, so it may cut a longer coach reply. Neither session changed an answer or score automatically.

Text review: the coach referenced the documented interim coordinator and board authorization for paper appointments. The examiner acknowledged the answer and directed the member to review and submit, without giving advice or a score. These are two smoke samples, not a broad quality or repeatability benchmark. Microphone permission, echo cancellation, actual speaker sound and real human interruption still require browser testing. Interruption messages and cancellation paths are covered with controlled tests.

An earlier isolated probe authenticated and returned text but timed out with only tiny PCM fragments; it is retained in [the probe record](evaluations/live-audio-probe.json). It was not accepted as audio verification. The final configuration uses a 2048 token output bound and fixed Kore voice; the full integration then returned substantial nonzero PCM. This does not establish which change resolved the earlier probe. Initial workflow attempts also failed before Live because the opening stream did not complete and, after a restart, the HTTP server was not yet ready. The complete later run passed.

Regression checks passed: 160 playtest tests, 47 Node UI tests, 31 existing project tests and the authored demo. These checks cover authentication, origins, stale questions, member isolation, one connection per member, audio format validation, transcript review, unchanged scoring, capture resampling and stopping during pending microphone permission or worklet loading. Browser visual and listening checks remain manual.
