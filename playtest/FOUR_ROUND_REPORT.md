# Working four round beta and recordings

Implemented on `experiment/ai-voice-playtest` in the isolated local application. [The workflow](FOUR_ROUND_WORKFLOW.md) explains the AI interaction; [the guide](ROUNDTABLE_GUIDE.md) gives the controls. New browser rooms use `four_rounds` and the included T01 **Service outage and unavailable director** report.

## Delivered behaviour

1. The opening preparation agent and shared Round 1 remain. Three expert perspectives precede each member's individual decision.
2. Round 2 creates three isolated private branches. Each member has one coach, three exchanges and an editable seven field response card requiring confirmation. No points are awarded.
3. Round 3 retains the same agent identity as examiner. The three stages score up to 30, 40 and 30 using the member's submitted answers. Positive criterion points require exact supporting quotes. Detailed feedback appears only after that member finishes assessment.
4. Round 4 opens after all three assessments. A live summary compares alternative branches. Each member can flag an existing answer quote for correction, then confirms review. The server determines the highest final score; the CEO announces it after the gates pass. Equal highest totals share the win.
5. Beta mode fixes the approved twists and question order. The CEO can disable it before Start for adaptive Gemini questions. Live sampling is temperature zero in beta and for scoring, 0.3 for adaptive dialogue. Generated wording and scores are not guaranteed identical.
6. Saved answers are offered only for the authenticated member and current stage. Playback, caption draft review and submission are separate. Own typed answers and explicit reviewed microphone transcription remain available. Speech and stop controls remain visible through private rounds and reunion.

## Audio assets

Twenty seven new ElevenLabs Flash v2.5 human clips were generated in four batches at concurrency two, using the existing three participant voices. Their total duration is **525.607 seconds**, about 8 minutes 46 seconds. Generation reserved **8,601 conservative speech units** under the existing unlimited authorization. This is local metering, not an exact invoice.

| Stage | New clips |
| --- | --- |
| Round 1 individual decisions | 3 |
| Round 2 coaching answers | 9 |
| Round 3 assessment answers | 9 |
| Round 4 reflections | 6 |

Together with nine existing discussion turns, the current exercise offers **36 human recordings**. All 53 prior manifest entries and assets are preserved; the full historical catalog now contains 80 clips. Old voting guides are not used in this flow. AI speech is generated live, with canonical beta question text supplied by code.

All new assets passed ffprobe duration checks, file SHA256 and source caption checks. [The recording report](evaluations/four-round-recordings.json) preserves their details. Replaying a saved MP3 does not invoke a paid provider. No human listening assessment is claimed.

## Automated verification

1. **153 playtest Python tests** passed, including all 27 new MP3 files through authenticated playback, elapsed duration, draft review and explicit submission gates using a controlled clock.
2. **31 existing project tests** and the authored prototype demo passed.
3. **42 Node UI checks** passed, including selected identity controls, private answer and card confirmation, automatic request deduplication, sample playback before draft loading, and rejection of late transcription for a newer private question.
4. Private session tests run three agent preparations concurrently and verify that each prompt and snapshot excludes the other members' original decisions and private answers.
5. Scoring tests reject out of range values, fabricated quotes and provider failures while preserving submitted answers. They cover withheld interim feedback, failed correction withdrawal, score invalidation, all reviews required and joint winners.
6. Stream tests verify PCM events and preservation of the complete written question when speech fails. These use synthetic providers; the separate live evidence below uses actual services.

[Integrity checks](evaluations/four-round-integrity.json) also passed for 166 unique DOM IDs, current guide copies, documentation links, all 80 audio hashes and credential patterns in changed text.

## Live beta check

[The complete beta run](evaluations/four-round-live.json) used three HTTP memberships, real local Gemma retrieval, live Vertex Gemini, and selected ElevenLabs PCM streams. Scripted human captions were submitted as typed answers, not presented as real participant speech or MP3 playback. The file playback path is covered separately by controlled clock tests.

All four rounds completed. Three private branches progressed concurrently with distinct agent identities. All nine assessment stages were scored, six reunion reflections were saved without new points, every member confirmed review, and the winner gate completed. No speech stream errors were reported.

The measured sample totals were **Alex 76, Morgan 66 and Sam 64**. These are test run observations, not expected scores baked into the program. Scores and supporting reasons are retained in the report.

| Stream | First text | First PCM | Request completion | Audio duration |
| --- | --- | --- | --- | --- |
| Preparation | 1.718 s | 2.460 s | 5.784 s | 21.87 s |
| First private coach | 1.414 s | 1.727 s | 2.869 s | 16.76 s |
| Fixed first examiner question | 0.062 s | 0.276 s | 1.384 s | 13.93 s |
| Reunion | 3.255 s | 3.491 s | 10.010 s | 79.18 s |

Across 24 private endpoint requests, including fixed prompts, card generation and grading, median completion was **2.522 seconds** and the slowest was **35.470 seconds**. These are request times including retrieval, providers and any speech generation, not GPU inference measurements. HTTP received audio faster than its playback duration; this does not measure perceived browser listening latency.

The initial attempt completed preparation and all experts but stopped at a test runner argument collision during individual submission. That harness was corrected, then the full run passed. [The initial evidence](evaluations/four-round-live-initial.json) is retained rather than presented as a completed run.

## Response quality review and follow up

The successful beta run maintained outage, disclosure and backup uncertainty. Its reunion explicitly kept the branches separate and identified concrete differences in communication, authority and fallbacks. Rubric deductions generally distinguished a clear statement from an incomplete owner, authorization or review arrangement.

Two limitations appeared in the generated content. Some card fields were marked as needing confirmation even when the private answers contained a proposed responsibility or update. Some assessment reasons referred to the obsolete voting procedure in the original reference PDF. Follow up prompts now prioritize the three coaching answers when drafting cards and explicitly exclude the old voting mechanism from current gameplay and scoring. The grader also receives the actual question asked in adaptive mode, alongside its canonical stage purpose.

[The completed adaptive run](evaluations/four-round-adaptive-live.json) passed all four rounds after those changes. Its questions responded to the member's own plan while retaining the approved developments. The revised cards preserved proposed coordinator responsibility, factual updates and review arrangements, marking exact names or times as unconfirmed when absent. No final rubric reason required the obsolete voting procedure. The sample totals were Alex 83, Morgan 66 and Sam 54; the same saved answers were intentionally used even where an adaptive question asked for more detail.

Across its 24 private requests, median completion was 4.250 seconds and maximum was 22.335 seconds. The reunion stream completed in 13.299 seconds and returned 81.97 seconds of PCM. Questions sometimes read document clause IDs aloud and can be verbose; this remains a conversational quality limitation.

[An earlier adaptive attempt](evaluations/four-round-adaptive-initial.json) stopped on an HTTP 502 near Alex's final assessment. The first harness did not retain the error body or membership checkpoint, so its exact model validation cause is unknown and it is not counted as a completed run. The harness now records sanitized errors, per member progress and an ignored local membership checkpoint; `--resume` explicitly retries a failed private run without replaying earlier submissions. Recovery state and score preservation are tested with synthetic failures. The later complete adaptive run required no retry. A startup connection race before that run made no provider call and was resolved after server readiness.

The beta numbers above remain the original measurement, not a test of the later prompt version. Current local metering after generation and all live checks is US$8.80 reserved for Vertex and 37,393 conservative speech units, including prior work. Both ledgers retain unlimited authorization; these totals are not provider invoices.

## Practical limits

This is a three member, single report localhost beta. Rooms are in memory and are lost on restart. The single window test bundle intentionally holds three memberships; it is not production account isolation. Audio plays in the requesting browser, without synchronized conference audio across browsers.

Preparation lasts 30 seconds and discussion allows up to five minutes; later stages wait for explicit completion. The proposed 15 minute total is not enforced. Gemini rubric judgments are not a validated psychometric assessment. Exact quote checks establish that evidence exists, not that a judgment is necessarily fair. Scripted fixture scores do not measure a human participant's ability.

Browser visuals, real microphone permissions and human listening remain manual checks. No Velocity GPU services or teammate production modules were changed. All existing paid usage reservations remain intact.
