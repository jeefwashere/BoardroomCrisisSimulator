# Vertex Flash evaluation

Measured November 7, 2026 on the isolated `experiment/ai-voice-playtest` branch. All active text and extraction requests now use **Gemini 3.8 Flash with LOW reasoning through Google Vertex AI Express**. ElevenLabs Scribe v2 and Flash v2.5 remain the speech services. The local model API is no longer called by this application; shared GPU services and downloaded weights were left intact.

## What changed

1. Preparation, Facilitator, IT, Journalist, custom action mapping, tracking and debrief use the selected Vertex model. The backend owns permissions, clocks, ballots and committed outcomes.
2. Characters and debrief still select exact authored evidence. Model output cannot introduce arbitrary claims or rewrite the scenario. Changing the provider does not make these roles unrestricted conversational agents.
3. Tracking uses Gemini JSON extraction. Only literal substrings of the committed contribution are accepted; the server derives offsets. Confidence scores are null rather than invented.
4. Every request explicitly sends `thinkingLevel: LOW`. The backend sends the key in a header to the fixed Vertex endpoint. No automatic retries or local model fallback are enabled. Public job metadata includes model, thinking level and reported usage, without prompts or credentials.
5. A persistent SQLite ledger reserves US$0.05 before each Vertex attempt under the user confirmed **US$2 cap**. Failures remain reserved and a restart does not restore allowance. The existing speech ledger and audio cache were retained.

## Same fourteen case comparison

The same public report questions, uncertainty checks, opening questions, prepared round, tracker, simultaneous post round questions and debrief used for the local baseline were rerun. These are single small samples, not a load test or general accuracy benchmark.

| Measure | Vertex Flash LOW | Earlier local baseline |
| --- | --- | --- |
| Completed requests | 14 of 14 | 14 of 14 |
| Specific evidence or span criteria | 14 of 14 | 14 of 14 |
| Median application total | 1.58 seconds | 6.07 seconds |
| Minimum application total | 1.11 seconds | 2.51 seconds |
| Maximum application total | 11.97 seconds | 13.23 seconds |
| Median client wait | 2.03 seconds | 6.20 seconds |
| Prepared round elapsed | 90.27 seconds | 90.49 seconds |
| Committed consequences | 1 | 1 |

Request timings include network and provider queueing. The local provider also uses hosted polling. These measurements do not isolate GPU inference speed or time to first token. The first Vertex report query took almost twelve seconds; later requests were generally shorter. One separate custom round Facilitator request took 9.44 seconds, so occasional long waits remain.

The three post round requests were submitted concurrently. Facilitator completed in **1.49 seconds**, IT in **2.18 seconds**, and Journalist in **1.48 seconds**. Each cited `decision_1` and returned the recorded minimum of 160 exported records with the investigation still incomplete.

## Response quality review

1. All three report baseline questions selected the expected clause. The insurance answer preserved uncertainty, the cross report question returned unknown, and the instruction resistance case kept both candidates' availability unconfirmed. These few cases do not establish universal resistance to misleading prompts.
2. Character replies remained identical passages for the shared opening and consequence questions. Grounding is useful, but role differentiation and conversational richness remain limited by the application evidence selection design.
3. The tracker correctly found `Jeff`, `call IT` and `3 PM`, and classified the combined action and question as `mixed`. It also selected `verified` as an action from the question about the backup. That extra span is questionable and requires human review. The automated criterion checks required spans, so its pass is not a claim that every predicted span was correct.
4. The debrief preserved the actual committed outcome and added an authored reflection. It remains generic and does not assess the quality of a whole discussion.
5. In a separate real HTTP game, all three clients voted for a custom proposal to isolate the finance device, revoke credentials, preserve evidence and keep checkout running. Vertex selected `targeted_containment` in **3.02 seconds**. The server validated it and committed the authored consequence once. All four model jobs in that game completed. Rejoin preserved the member and ballot.

## Speech integration after the switch

The Vertex Facilitator selected the question “Who owns the incident and the continuity assumptions?” The application served its previously generated ElevenLabs audio, transcribed it and committed the provisional text only after a separate command.

| Measure | Observed |
| --- | --- |
| Audio retrieval | 0.327 seconds, cached TTS |
| Fresh transcription request | 0.469 seconds |
| Clip duration | 3.07 seconds |
| Transcript | Exact words of the supplied question |
| Normalized word error rate | 0 on this single synthetic clip |
| Additional speech reservations | 400 credits |
| Shared speech ledger now | 1,690 reserved, 8,310 remaining of 10,000 |

Cached retrieval is not a fresh speech synthesis latency result. The earlier fresh TTS measurement remains 1.96 seconds in [the local baseline report](MEETING_REPORT.md). This run did not test a human microphone or repeat browser visual and audible quality checks. It used HTTP clients against the same server used by the single window UI, respecting the request to leave computer controls alone.

## Spending and verification

There were **21 Vertex attempts**, including the tiny connection probe, fourteen comparison cases, four custom round jobs and two voice setup questions. The ledger has **US$1.05 reserved and US$0.95 remaining** of the US$2 test cap. These reservations exceed the estimated token charge and are not refunded automatically.

Reported total usage was 4,414 input tokens, 347 visible output tokens and 375 thinking tokens. At the [published global introductory rates](https://cloud.google.com/model-garden/pricing) checked November 7, the token based estimate is approximately **US$0.0060**, not an invoice. The conservative ledger uses higher standard rates and bounded request sizes. The US$2 allowance measures this local test only and does not measure unrelated Google account spending or replace the overall account allowance.

Verification passed **39 playtest tests**, **31 existing tests**, the prototype demo, JavaScript syntax and DOM reference checks. The additional provider tests cover explicit LOW reasoning, header only credentials, literal extraction, concurrent budget reservations, persistent ceilings, sanitized failures and absence of retries. The served meeting page has Vertex labels. The earlier browser visual check applies to the local baseline; this provider change was checked through code and actual HTTP tests.

## Evidence and how to try it

1. Open <http://127.0.0.1:8788/meeting> on this Mac and click New room or Run 90s scripted demo. The server restart discarded previous memory only rooms; room `KRF6TY` survives in its saved export.
2. Read [the test guide](TEST_GUIDE.md) for each report's questions and expected evidence, or [the progress record](PROGRESS.md) for the overall architecture and remaining work.
3. Raw results: [fourteen Vertex cases](evaluations/vertex-agents.json), [custom round](evaluations/vertex-custom-round.json), [speech round trip](evaluations/vertex-voice-roundtrip.json) and [summary with budgets](evaluations/vertex-summary.json).
4. Local baseline: [measured report](MEETING_REPORT.md) and [raw cases](evaluations/local-agents.json).

The app is a localhost experiment, not a public deployment or production merge. T01, T02 and T03 remain public reference packs rather than complete playable scenarios. Natural conversation, noisy human audio, larger participant loads and production integration remain unverified.
