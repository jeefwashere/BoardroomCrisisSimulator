# Rehearsal four round playtest

Latest X22: [CEO skip controls](SKIP_ROUNDS.md) let you skip the introduction and exercise rounds for testing. Use the updated app on port 8790; earlier servers preserve their existing rooms. Missing work stays marked as skipped.

Latest X21: [optional Gemini Live private audio](LIVE_AUDIO_WORKFLOW.md) adds explicit microphone conversation in Rounds 2 and 3, native Gemini speech and reviewed transcript drafts. Use port 8789 for the updated local test server. Ordinary speech remains Gemini plus ElevenLabs.

Latest X20: Round 1 now uses [one guided answer box](SINGLE_ANSWER_UPDATE.md), including saved audio drafts and reviewed microphone transcription.


Working branch: **`experiment/ai-voice-playtest`**. Open [the local meeting](http://127.0.0.1:8790/roundtable), load three test participants and start as CEO. The included PDF is **Service outage and unavailable director**, about fictional Cedar Bridge Community Services.

Read [the test guide](ROUNDTABLE_GUIDE.md), [Gemini and ElevenLabs workflow](FOUR_ROUND_WORKFLOW.md), [confirmed design](FOUR_ROUND_DESIGN.md) and [verification report](FOUR_ROUND_REPORT.md). The [formatted guide](http://127.0.0.1:8790/roundtable-guide) is also saved as `/Users/arjunbehl/Downloads/Rehearsal_Roundtable_Guide.html`.

1. Round 1 retains the 30 second live preparation opening, up to five minutes of discussion, three expert perspectives and each member's individual decision. No points.
2. Round 2 gives each member a private crisis coach, three questions and a reviewed response card. No points.
3. Round 3 keeps the same agent as examiner, with three stages worth 30, 40 and 30 points. Only submitted assessment answers earn points.
4. Round 4 reunites the board, compares separate branches, supports evidence corrections and announces the highest final score after all reviews. No new points.

Beta test mode fixes questions to match the saved fictional human answers. The CEO can switch it off before Start for adaptive Gemini questions. The app offers 36 current exercise recordings across the four rounds. Playback, draft review and submission are separate actions. Ordinary agent speech uses Gemini text plus ElevenLabs; AI replies are not saved participant recordings.

## Run locally

Use the existing virtual environment and backend environment file:

```sh
.venv/bin/python -m playtest \
  --env-file ../BoardroomCrisisSimulator/.env.local \
  --port 8790 --unlimited-budget \
  --allow-name-rejoin
```

The user explicitly removed application spending caps. Both persistent usage ledgers retain that authorization and all reservations. Do not delete them to restart. Provider billing and availability remain outside this application setting.

For a fresh environment, install the declared dependencies into a virtual environment only with the operator's authorization. [PDF memory setup](PDF_MEMORY.md) explains the separate explicit model download and index setup. Page loads do not download models. This machine already has the cached model and indexed public report.

## Agents and authority

| Component | Responsibility |
| --- | --- |
| Local EmbeddingGemma | Retrieve relevant passages from this room's PDF |
| Vertex Gemini Flash LOW | Preparation, facilitation, three experts, private coach/examiner, rubric judgments and reunion comparison |
| Gemini minutes | Select exact shared discussion quotes |
| ElevenLabs Flash v2.5 | Stream generated agent words as speech |
| ElevenLabs Scribe v2 | Transcribe explicitly submitted microphone recordings into provisional text |
| Server | Enforce membership, stages, revisions, submission gates, valid rubric evidence, totals and winner |

The current configuration is Gemini 3.8 Flash with LOW reasoning and cached `google/embeddinggemma-2` on the local CPU. No local conversation API or Velocity GPU is required. Private JSON is validated before speech streaming. Shared Round 1 supports sentence speech while Gemini text streams. See [the workflow](FOUR_ROUND_WORKFLOW.md) for the precise distinction and reliability limits.

## Storage and scope

This is an isolated localhost prototype for exactly three members and the included T01 report. New browser rooms use `four_rounds`; `board_round1` and `legacy` remain for older regression checks. The old ballot clips stay on disk and do not play in the current flow. The separate audio website remains removed.

Each membership has a bearer token. The single window test bundle intentionally holds all three identities; independent browsers have their own membership. Private answers remain scoped until reunion. Provider keys stay in the ignored backend environment file and are excluded from exports.

Rooms live in process memory and disappear on restart. Export the written record first. Model weights, vectors, uploads, caches and usage ledgers stay in ignored local storage. The proposed 15 minute schedule is not an enforced total timer. Audio plays in the requesting browser, without a synchronized conference broadcast. This branch does not replace teammate production modules or constitute an Internet deployment.

## Verify

```sh
.venv/bin/python -m unittest discover -s playtest/tests -q
.venv/bin/python -m unittest discover -s tests -q
.venv/bin/python -m rehearsal demo
node --test --test-concurrency=1 playtest/tests/*ui.test.cjs
```

The optional paid check is `python -m playtest.four_round_benchmark --live`. It uses three HTTP identities, scripted typed answers and real Gemini, retrieval and selected ElevenLabs streams. Controlled clock tests separately exercise every new MP3 playback and draft gate. HTTP and Node checks do not establish browser visual quality, human microphone permission or listening quality.
