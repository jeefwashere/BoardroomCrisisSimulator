# Single window meeting evaluation

Measured November 7, 2026 on the experimental local app. Test interface: <http://127.0.0.1:8788/meeting>. This report covers the existing LFM3 and GLiNER service plus ElevenLabs speech APIs, not a separately managed ElevenLabs conversational agent.

## What is implemented

1. A dark meeting layout with three controllable test seats, three character cards, discussion, voting, optional speech, a round review and downloadable results.
2. A 90 second scripted demo with three labelled participant contributions and prepared votes. Model replies are live. The script is test automation, not evidence of autonomous humanlike AI participants.
3. Concurrent submission of Facilitator, IT and Journalist reviews after the round. The shared GPU queue still serializes inference. The normal five minute profile remains available for manual discussion.
4. Visible request status and measured total, local thread queue and provider round trip times. Provider round trip includes the hosted queue and its polling. No measurement here isolates GPU compute or time to first token.
5. Existing Scribe transcription and Flash speech controls under the persistent 10,000 credit cap. Speech requires an explicit action; the scripted demo does not spend speech credits automatically.

## Local agent measurements

Fourteen live requests completed and passed their individual evidence or extraction criteria. This is a small functional sample, not a broad accuracy benchmark. The fixture explicitly constrains responses to authored evidence, so grounding reflects both model selection and application validation.

| Measure | Observed |
| --- | --- |
| Completed requests | 14 of 14 |
| Specific evidence or extraction criteria passed | 14 of 14 |
| Application measured median total | 6.07 seconds |
| Application measured minimum and maximum | 2.51 to 13.23 seconds |
| Client observed median including request and result polling | 6.20 seconds |
| Client observed minimum and maximum | 2.55 to 16.79 seconds |
| Three post round reviews submitted together | Client results in 4.10 to 6.20 seconds |
| Real HTTP round | 90.49 seconds, three seats, one committed consequence |

The three baseline preparation requests ran sequentially. The uncertainty cases, opening character requests and post round reviews ran in groups of three. Differences across groups also reflect different prompts, transport and queue load; this is not a controlled hardware throughput comparison.

| Test group | Requests | Observed response quality |
| --- | --- | --- |
| T01, T02 and T03 preparation | 3 | Correct clauses for verified restoration prerequisites, net proceeds and appointment versus payment access |
| Insurance uncertainty | 1 | Correctly says missing evidence does not determine coverage denial |
| Cross scenario question | 1 | T02 refuses to supply T03 appointment facts |
| Instruction resistance | 1 | Retains that availability is unconfirmed despite a request to claim acceptance |
| Opening characters | 3 | Correct opening evidence, but all three return the same passage to the same question |
| GLiNER tracking | 1 | Extracts Jeff, call IT and 3 PM with exact matching source offsets |
| Concurrent post round characters | 3 | Correct committed consequence; all three return the same passage to the same question |
| Debrief | 1 | Cites round 1 and preserves that the export count is a confirmed minimum, not the final scope |

## Assessment of usefulness

1. Grounding was strong for this sample. No tested answer invented an acceptance, coverage denial, confirmed availability or later scenario event.
2. Preparation answers were useful for specific document questions. They are clause selections, not complete document analysis or general reasoning.
3. Character differentiation was weak. The same question produced identical answers from Facilitator, IT and Journalist. Role names alone do not make this a natural discussion. Role specific authored evidence or reviewed conversational responses would be needed to improve that experience.
4. The debrief was accurate but brief. It restated the consequence and one reflection; it did not assess nuanced group performance.
5. Tracking worked on one simple sentence. The result does not establish accuracy on noisy speech, pronouns, negation or complex cross speaker ownership.
6. Latency suits short asynchronous questions and post round review better than fluid, interruptible voice conversation. Some waits exceeded ten seconds. Hosted polling and network time are included, so these numbers cannot diagnose model compute alone.
7. Only one instruction resistance and one cross scenario case were tested. They do not establish universal prompt injection resistance.

## Single window browser test

A real Chrome window completed the scripted demo in room `KRF6TY`. It showed three separate test memberships, three committed scripted contributions, a prepared vote result, and one consequence. Six model jobs completed: tracking, a discussion facilitator reply, three concurrent post round character reviews and debrief. The result export was downloaded and checked.

| Browser measure | Observed |
| --- | --- |
| Completed model jobs | 6 of 6 |
| Median application total | 4.26 seconds |
| Minimum and maximum application total | 2.77 to 6.04 seconds |
| Post round Facilitator | 6.04 seconds |
| Post round IT | 6.01 seconds |
| Post round Journalist | 3.04 seconds |
| Fresh debrief speech plus fetch in the UI | 6.11 seconds |
| Playback check | Audio scrubber advanced from zero to about five seconds after Play |

The UI used different post round questions. IT and Journalist returned the relevant consequence. Facilitator was asked what was decided **and** what to clarify next; it returned the consequence but omitted the second part. That response is partially useful, not a full answer. All three still selected the same passage, confirming weak role differentiation even with different prompts. The debrief gave one accurate reflection but no detailed discussion assessment.

Browser speech added 199 reserved credits after the short synthetic speech benchmark. Total additional reservations in this task were 652 credits. The final shared ledger is **1,290 reserved and 8,710 remaining**. The playback check verifies player progress, not a human rating of voice naturalness. Human microphone quality remains untested.

## ElevenLabs speech measurement

One short live local agent reply was spoken by Flash v2.5 and sent through Scribe v2. This used generated fictional speech, not a human microphone recording.

| Measure | Observed |
| --- | --- |
| Spoken text | Who owns the incident and the continuity assumptions? |
| Fresh TTS generation plus audio fetch | 1.96 seconds; not cached |
| Generated audio duration | 3.07 seconds |
| Transcription request | 3.08 seconds |
| Returned transcript | Who owns the incident and the continuity assumptions? |
| Word error rate ignoring punctuation and case | 0 on this one short synthetic clip |
| Explicit commit boundary | Transcript remained provisional until a separate contribution command |
| Additional reserved credits | 453 |
| Shared ledger after this test | 1,091 reserved; 8,909 remaining out of 10,000 |

The application reserves one credit per character and 400 per short transcription, conservatively within the rates on the [ElevenLabs pricing page](https://elevenlabs.io/pricing). Reservations are not an exact provider invoice. Browser playback, microphone acoustics, human accents, interruption quality and conversational turn detection are not established by this synthetic round trip.

## Evidence and limits

Raw sanitized results: [local agent results](evaluations/local-agents.json), [browser meeting export](evaluations/browser-meeting.json) and [speech round trip](evaluations/voice-roundtrip.json). These contain questions, actual replies, citations, timings and criteria. They omit credentials and membership tokens.

The first harness attempt completed and saved all nine preparation and opening checks, then Start rejected inactive test seats. The harness was corrected to refresh every test seat before Start. The saved model results were retained, and a fresh room completed the round and remaining five checks. That harness failure was a presence setup issue, not a model response failure.

The text benchmark made no paid speech requests. The speech test used the same persistent ledger as the browser. No new Slurm allocation, duplicate GPU model, package installation or public server exposure was needed. Production teammate modules remain unchanged.
