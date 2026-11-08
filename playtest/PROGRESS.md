# Rehearsal implementation progress

Latest X23: [saved clips can speak into Gemini Live](RECORDED_LIVE_AND_SECTIONS.md) without microphone access. Only introduction and discussion sections can end early; decisions, private answers and reviewed cards remain mandatory. Current test app: port 8791.

Historical X22 offered whole round bypasses. X23 removes them and retains required decisions and answers.

Earlier X21: [optional Gemini Live private audio](LIVE_AUDIO_WORKFLOW.md) adds explicit microphone conversation in Rounds 2 and 3, native Gemini speech and reviewed transcript drafts. Use port 8789 for the updated local test server. Ordinary speech remains Gemini plus ElevenLabs.

Latest X20: Round 1 now uses [one guided answer box](SINGLE_ANSWER_UPDATE.md), including saved audio drafts and reviewed microphone transcription.


## Current X19 four round beta

Working Rounds 2 through 4 now extend the preserved opening and group Round 1. The private coach, response card, same agent examiner, evidence based 100 point assessment, reunion corrections and winner gates are implemented. Beta questions align with 27 new human recordings; switching beta off before Start enables adaptive Gemini follow ups. The current exercise has 36 human clips in total. Read [the workflow](FOUR_ROUND_WORKFLOW.md), [controls](ROUNDTABLE_GUIDE.md) and [verification](FOUR_ROUND_REPORT.md).

Earlier sections below describe historical checkpoints. X19 supersedes their private rounds deferred and legacy ballot default statements. The user approved unlimited ledgers remain intact.


Status snapshot: November 7, 2026, updated for task X18. The single window local model experiment is implemented and evaluated. The active test application now routes all text agents and extraction to Gemini 3.8 Flash with LOW reasoning through Google Vertex AI, with no local model fallback. The same fourteen case comparison has completed. The custom proposal round and Vertex speech integration check also passed.

The work is isolated on branch `experiment/ai-voice-playtest` in `/Users/arjunbehl/Developer/CommuniHacks/BoardroomCrisisSimulator-ai-playtest`. It has not been merged into the production application. Existing teammate modules and the shared GPU service are preserved.

## Current X18 group first round

The default browser flow now follows [the four round design](FOUR_ROUND_DESIGN.md) through Round 1 only. The preparation agent remains. Discussion leads to three live experts and separate member decisions with no points. Each member's frozen context supports future private coaching without exposing another member's individual decision. The earlier ballot flow is retained as legacy. [Current report](ROUND_ONE_REPORT.md).

## Current X17 voting guide

A new 23.13 second ElevenLabs guide explains CEO custom proposals, explicit member ballots, reset on a new option and CEO confirmation or selection among tied leaders. Only the CEO can add custom options through the UI or API. Existing nine participant recordings remain unchanged. See [the voting audio update](VOTING_AUDIO_UPDATE.md).

## Current X16 conversation and custom ballot

Nine new manual participant recordings provide 134.40 seconds of T01 discussion, three turns per participant, plus a 21.97 second recorded voting guide. The UI shows the current ordinal and does not loop after the ninth clip. The custom response form can add a choice beside the prepared responses. Adding one restarts the ballot, requires acknowledgement if votes exist, and rejects stale votes. A custom winner becomes the canonical decision used by live Gemini evaluation. See [the current report](EXTENDED_CONVERSATION_REPORT.md) for verification and limits.

The X14 and X12 sections below describe earlier checkpoints; X16 replaces their three recording and prepared choices only limits.

## Current X14 UI voting

The fixed ballot now asks each member by name in server enforced first vote order. Choose this response selects a local draft; Confirm my vote submits it. The single window test view moves to the next member and returns to the CEO only after every ballot. Separate browser identities remain unchanged. Missing votes block commitment, and stale controls cannot submit for a different selected member. See [the guide](ROUNDTABLE_GUIDE.md) and [current verification](GUIDED_ROUND_REPORT.md).

## Current X12 guided round

The current main page uses one T01 PDF, a 30 second live introduction, manual participant turns with a five minute maximum, a visible one minute consultation window and a fixed choice ballot. The CEO may end discussion early and skip consultation. Three new participant recordings provide about 46 seconds of useful discussion about leadership, recovery checks and communication. They remain manually played and separately committed.

Facilitator, IT and journalist consultations remain live. At voting, a clearly labelled 20 second prerecorded decision guide reads three authored choices. Each member explicitly chooses, and the CEO commits the winning result or resolves a tie. The live evaluation receives the actual result. This specific recorded guide is the user's requested exception to the earlier all live agent speech rule. Replay makes no provider calls. Unlimited usage accounting remains active. [Current verification](GUIDED_ROUND_REPORT.md) and [the guide](ROUNDTABLE_GUIDE.md) describe the flow.

## Historical X11 meeting

The main page loads one T01 PDF and offers three ready test participants. CEO Start gives a 30 second live introduction, then a five minute turn based discussion. Manual playback controls live beneath each participant, with a clear current turn indicator; participant autoplay is removed. Only three participant recordings are available. Every AI agent voice is generated live through Gemini and ElevenLabs.

The CEO can consult facilitator, IT and journalist agents and finish the round early. A decision guide prompts human choices. Votes and CEO confirmation determine the result, then an evaluation agent interprets the actual decision. The full live HTTP flow passed, including six streamed roles and three timed recording commits. Introduction audio was 26.19 seconds; first speech arrived in 1.82 to 2.65 seconds across the roles. See [the report](STREAMING_PREPARATION.md) and [guide](ROUNDTABLE_GUIDE.md).

The user then removed application spending limits. Both persistent ledgers are unlimited, with all history preserved. Tracked totals at this update are 8,713 speech units and US$2.00 Vertex reservations. The old cap figures below describe historical checkpoints and no longer block this application. The separate recorded audio website is removed. Browser listening, visual layout and microphone permission remain manual checks; no computer controls were used.

## New CEO meeting workflow

The separate `/roundtable` mode adds three preloaded demo PDFs, room scoped Gemma embedding retrieval and cited preparation answers. Everyone marks ready; the CEO starts and can skip either one minute facilitator window. Three minute discussion produces a written transcript. The minutes agent selects exact contribution quotes and proposes decision questions. People submit proposals and votes; the CEO explicitly records the result. Microphone transcription remains an explicit Scribe request followed by review and a separate text submission.

[The guide](ROUNDTABLE_GUIDE.md) explains the one window three seat test. [The roundtable report](ROUNDTABLE_REPORT.md) records current verification and limitations. The new mode keeps its own room state, with the same provider objects and persistent spending ledgers as the existing pages. The model download and local PDF vectors are not committed. No Velocity service or production frontend is changed.

The X10 verification passed 88 playtest tests, 31 existing tests and eight Node UI checks. Six real Vertex jobs and one explicit Scribe fixture transcription completed. The app preparation questions found the expected evidence in all three public reports. At the X10 checkpoint, reservations were US$1.55 of US$20 and 5,782 of 30,000 credits. The standalone readable guide is `/Users/arjunbehl/Downloads/Rehearsal_Roundtable_Guide.html`.

## What is already implemented

1. A single window meeting interface at <http://127.0.0.1:8788/meeting> with three independently authenticated test seats, Facilitator, IT and Journalist cards, typed contributions, voting and result export.
2. A 90 second mechanics demo. It submits scripted participant contributions and prepared votes, then requests real model replies. The test seats are explicitly simulated; they are not autonomous conversational participants.
3. Concurrent submission of three character reviews after the round, followed by a debrief. Concurrent submission does not imply three independent GPU models or concurrent GPU execution.
4. A normal five minute single round profile for manual discussion. The 90 second profile uses a 15 second vote; the normal profile retains a 60 second vote.
5. Text interaction, optional microphone transcription, optional spoken replies, visible job status, request timings and manual quality review fields. Transcription remains provisional until a separate contribution command commits it.
6. Local test recovery by the same room and display name when explicitly enabled. Leaving releases the seat immediately; an inactive closed tab can be recovered after 30 seconds. The old token is revoked and the existing membership and ballot are preserved.
7. Scoped preparation retrieval over the public T01, T02 and T03 participant packs. Hidden event schedules and reviewer answers stay outside participant retrieval.

The playable exercise is the MapleCart scenario. T01 service outage, T02 fundraising allegation and T03 succession and payroll currently support preparation questions; their complete timed gameplay is not implemented.

## Agents and ownership

| Responsibility | Verified local baseline | Active Vertex test configuration | Authority |
| --- | --- | --- | --- |
| Preparation | LFM3 selects participant document clauses | Gemini 3.8 Flash, LOW | Read only evidence selection |
| Facilitation and characters | LFM3 serves Facilitator, IT and Journalist roles | Gemini 3.8 Flash, LOW for all three roles | Suggestions from released evidence |
| Evaluation | LFM3 selects an allowed custom outcome or authored debrief reflection | Gemini 3.8 Flash, LOW | Backend validates and commits any permitted outcome |
| Turn coordination | Application code | Application code | Owns speaking eligibility and turn changes |
| Discussion tracking | GLiNER extracts people, actions and deadlines | Gemini 3.8 Flash, LOW extraction with source validation | Suggestions require human review |
| Timekeeping | Application code | Application code | Owns phase deadlines |
| Decision checking | Application code | Application code | Reads authoritative committed history |
| Participation observation | Application code | Application code | Counts contributions and questions |
| Speech recognition | ElevenLabs Scribe v2 | ElevenLabs Scribe v2 | Returns provisional text |
| Speech generation | ElevenLabs Flash v2.5 | ElevenLabs Flash v2.5 | Speaks application approved text |

These are logical responsibilities, not eight separately running models. There is no managed ElevenLabs conversational agent controlling the exercise, no enabled mood detector and no OpenRouter fallback. Models cannot cast votes, assign roles, advance clocks or rewrite committed history.

The character and debrief responses in both the local baseline and Vertex test use exact authored passages selected by the model. This constrains unsupported claims but also limits conversational richness. Changing providers alone does not remove that application boundary.

## Completed local model evaluation

The detailed findings and actual outputs are preserved in [the meeting report](MEETING_REPORT.md) and its linked result files.

| Check | Observed result |
| --- | --- |
| Automated playtest tests | 34 passed |
| Existing prototype and board tests | 31 passed |
| Prototype demo, JavaScript syntax and DOM checks | Passed |
| Live model evidence and span cases | 14 completed; all 14 met their individual criteria |
| Application median request total | 6.07 seconds |
| Application minimum to maximum | 2.51 to 13.23 seconds |
| Real HTTP exercise | One consequence in 90.49 seconds with three seats |
| Browser exercise `KRF6TY` | One round, three contributions, three prepared votes and six completed model jobs |
| Browser job median | 4.26 seconds |
| Browser post round responses | Facilitator 6.04 seconds; IT 6.01 seconds; Journalist 3.04 seconds |

These request times include transport, hosted queueing and polling. They are not pure GPU inference times or time to first token. Fourteen targeted cases do not establish broad model accuracy.

Actual response review found useful source grounding and weak role differentiation. Facilitator, IT and Journalist often returned the same authored passage. In the browser test, the Facilitator answered what happened but omitted the second part of a question about what to clarify next. The debrief was accurate but generic. Tracking correctly found Jeff, call IT and 3 PM in one simple contribution; complex ownership and noisy speech remain untested.

## Completed ElevenLabs checks

One short synthetic agent reply was generated as speech and transcribed back to text. Fresh speech generation plus fetch took 1.96 seconds; transcription took 3.08 seconds. The 3.07 second clip returned the exact words, giving a normalized word error rate of zero on that one clip. The transcript remained provisional until explicitly committed.

The browser also generated and fetched debrief speech in 6.11 seconds. After Play, the audio scrubber visibly advanced to about five seconds. This verifies playback progress, not human rated naturalness or microphone quality.

At the end of the local baseline, the persistent speech ledger had **1,290 credits reserved and 8,710 remaining** under the shared **10,000 credit cap**. The latest task accounted for 652 of those reservations. Reservations are conservative limits rather than exact ElevenLabs invoices. New tests must retain the existing ledger and cache.

## Completed Vertex text comparison

The user confirmed `gemini-3.8-flash` with `LOW` thinking for the text responsibilities above and separately set a **US$2 test cap**. ElevenLabs remains the speech provider.

The first live Vertex connection check returned `{"ready":true}` in approximately **1.411 seconds**, with reported usage of nine input tokens and five output tokens. It reserved **US$0.05** under the persistent test budget. This is a tiny connectivity probe, not a representative agent latency or quality measurement.

The active application switch is implemented. All text and extraction requests use Vertex; there is no local model API fallback. Provider labels and job metadata identify the model and LOW reasoning. Verification passed 39 playtest tests, 31 existing tests, the prototype demo, JavaScript syntax and DOM checks.

The same fourteen case benchmark completed with all fourteen requests successful and all fourteen meeting their specific evidence or extraction criteria. The results are in [the Vertex evaluation](VERTEX_REPORT.md) and [the raw Vertex cases](evaluations/vertex-agents.json).

| Measure | Vertex result | Preserved local baseline |
| --- | --- | --- |
| Application median total | 1.58 seconds | 6.07 seconds |
| Application minimum to maximum | 1.11 to 11.97 seconds | 2.51 to 13.23 seconds |
| Completed specific criteria | 14 of 14 | 14 of 14 |
| Prepared consequence round | 90.27 seconds, one consequence | 90.49 seconds, one consequence |

The concurrent post round review requests completed in 1.49 seconds for Facilitator, 2.18 seconds for IT and 1.48 seconds for Journalist. The median improved in this sample, but one Vertex request still took almost twelve seconds. These are application request times across different providers, including transport and queue behavior; they do not isolate model inference speed.

The three characters still returned identical authored evidence. This provider change has not improved conversational richness or role differentiation under the existing response constraints. The tracker correctly extracted Jeff, call IT and 3 PM, but also labelled the word `verified` as an action even though it occurs within a question. That extra span is questionable and needs review. Its classification was `mixed`, compared with `question` in the local baseline. Vertex confidence scores are null because no calibrated extraction confidence is supplied.

Passing fourteen specific criteria does not mean perfect response quality. The narrow tracker criterion checks that required spans appear and does not penalize every extra span. The separate custom proposal round also passed: Vertex selected the permitted targeted containment outcome in 3.02 seconds and the backend committed it after the vote. All four jobs completed. The new speech integration check used cached audio and fresh transcription, returned the exact question, and preserved the separate contribution commit boundary. See the Vertex report for details.

The US$2 ledger is a local test subbudget, not an account wide Google billing meter. It does not measure unrelated project spending. Secrets remain on the backend and must not appear in Markdown, exports or browser code. Replacing application calls does not authorize deleting model weights, stopping shared cluster services or releasing a GPU allocation.

## Files to read on this computer

1. This progress record: `playtest/PROGRESS.md`.
2. [Manual tests and agent responsibilities](TEST_GUIDE.md): copyable questions and expected evidence for each participant pack, plus the one round procedure.
3. [Measured local baseline](MEETING_REPORT.md): timings, actual quality findings and limits.
4. [Application setup and boundaries](README.md): startup commands and current implementation details.
5. [Vertex comparison](VERTEX_REPORT.md) and [raw Vertex results](evaluations/vertex-agents.json).
6. [Raw local agent results](evaluations/local-agents.json), [browser room export](evaluations/browser-meeting.json) and [synthetic speech results](evaluations/voice-roundtrip.json).
7. Readable HTML results on this Mac: `/Users/arjunbehl/Downloads/Rehearsal_Meeting_Results.html`.
8. Current readable progress and Vertex results: `/Users/arjunbehl/Downloads/Rehearsal_Progress.html` and `/Users/arjunbehl/Downloads/Rehearsal_Vertex_Results.html`.
9. Readable HTML test guide on this Mac: `/Users/arjunbehl/Downloads/Rehearsal_Test_Guide.html`.
10. Downloaded browser export: `/Users/arjunbehl/Downloads/rehearsal-meeting-KRF6TY (1).json`.

The HTML files can be opened as ordinary browser documents without a Markdown editor. The local application requires its server to be running. It is not a public deployment, and this documentation does not grant Velocity access to teammates.

## Vertex comparison budgets before the recording library

The completed Vertex test made 21 attempts. Conservative reservations are US$1.05, leaving US$0.95 of the confirmed US$2 cap. This includes the connection probe, fourteen comparison cases, four custom round jobs and two voice setup questions. The token estimate is much lower and is recorded separately in the Vertex report; reservations are not invoices.

The additional speech check reserved 400 credits. The shared speech ledger now has 1,690 reserved and 8,310 remaining out of 10,000. Audio retrieval was cached; no new TTS generation latency is claimed. Fresh transcription took 0.469 seconds on the existing 3.07 second synthetic clip.

Implementation, automated checks and live HTTP comparisons are complete. Human microphone quality, natural conversation, broader extraction quality, load testing and production integration remain separate work. Publication status is recorded in TODO.md; this feature branch has not been merged into production.

## Reusable audio lab added in X09

The user requested parallel subagents to create many reusable ElevenLabs recordings and HTML plus Markdown test instructions. The new audio lab is at <http://127.0.0.1:8788/audio-lab>. It includes 36 fixed recordings in three standard voices, a free recorded 90 second demo, manual five minute conversations, turn controls, optional microphone and Scribe transcription, explicit live Vertex requests, proposals, voting and exports. The prerecorded speakers do not improvise; live agents are separately labelled.

Generation took 67.71 seconds with two concurrent requests. The library contains 142.29 seconds of audio and reserved 2,492 speech credits. All 36 MP3 files and captions passed integrity checks; a second generation command reused them without spending. They are embedded in the repository rather than depending on a future generation request.

Verification passed 51 playtest tests, 31 existing tests, the prototype demo and JavaScript checks. All 36 files were fetched through authenticated playback leases without additional provider reservations. A real HTTP round completed in 90.19 seconds with three recorded clips, three provisional transcripts, separate contribution commits, three votes and one outcome. The tracker and concurrent three role review all completed. The transcripts matched after case, punctuation and numeral normalization; IT appeared as it, so exact text still needs review.

The user subsequently increased total caps to **30,000 speech credits** and **US$20 Vertex**. At the X09 checkpoint, conservative reservations were **5,382 speech credits**, leaving **24,618**, and **US$1.25 Vertex**, leaving **US$18.75**. The explicit cap migration retains every existing reservation; restart alone cannot expand a stored cap. The preceding section preserves the earlier provider comparison checkpoint. No GPU services were changed.

Read [the audio guide](AUDIO_TEST_GUIDE.md) and [measured audio report](AUDIO_REPORT.md). The formatted guide is at <http://127.0.0.1:8788/audio-guide> and `/Users/arjunbehl/Downloads/Rehearsal_Audio_Test_Guide.html`. New browser, microphone and audible playback quality remain manual checks; this task did not use computer controls. Publication is recorded in TODO.md, and the feature branch is not merged.
