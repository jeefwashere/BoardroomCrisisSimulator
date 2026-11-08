# CEO meeting and PDF memory verification

The new local meeting page is available at <http://127.0.0.1:8788/roundtable>. Its [test guide](ROUNDTABLE_GUIDE.md) is also served as [formatted HTML](http://127.0.0.1:8788/roundtable-guide). This is an isolated prototype on `experiment/ai-voice-playtest`, not a production deployment or a merge into main.

## Implemented workflow

Three independent test memberships join and mark ready. The host may assign the existing CEO role to a different member. Only that CEO starts after documents finish indexing, skips either optional 60 second facilitator window, finishes discussion early, records decision outcomes and ends the meeting. Discussion otherwise lasts 180 seconds. Decision voting is untimed and requires explicit ballots from the frozen electorate. Unresolved proposals must be committed or explicitly cancelled before End.

The three public demo PDFs are preloaded. Additional text PDFs can be uploaded by the host or CEO before Start. Uploads block Start while indexing, reset member readiness when attached and are scoped to that room. The preparation agent retrieves real Gemma vectors and asks Gemini 3.8 Flash with LOW reasoning to select passages. Replies quote those passages with document and page citations. No hidden controller reference is indexed.

Typed contributions enter the written transcript explicitly. A microphone clip remains local until the explicit Scribe transcription action; its result stays provisional until the participant reviews and separately commits it. There is no continuous audio archive, automatic transcription or emotion inference. The side summary contains exact transcript quotes selected by Gemini. Decision prompts are suggestions; the model cannot cast votes or commit a decision.

## Automated verification

1. 88 playtest unit and HTTP tests passed, including 16 meeting engine tests, 14 route tests and seven PDF memory tests. Route tests use fake providers to exercise permissions, room isolation, upload readiness, stale facilitator results, strict citation validation, idempotency and provisional transcription without paid calls.
2. 31 existing prototype and board tests passed. The authored prototype demo passed. Teammate production modules were unchanged.
3. Eight persisted Node UI tests passed, including four new meeting checks for CEO and phase controls, tied ballots, stale transcription ownership and partial summary warnings. JavaScript syntax, document IDs and whitespace checks passed.
4. All six pages of the three generated PDFs were rendered and visually inspected. Every public source clause ID remains present. The isolated dependency environment passed its package consistency check.

## Actual Gemma retrieval

The cached model is `google/embeddinggemma-2` at revision `f9972ac22e696a105c482202646979e33e4b5a1e`. The text configuration loads 271,002,624 parameters on CPU in float32, with vision and audio disabled. The index contains 26 chunks with 768 dimensions. Weights, uploaded PDFs and the index remain in ignored local storage. The 1.49 GB checkpoint was downloaded once; no Velocity job was used.

The initial 45 tiny chunks found the expected evidence in two of three scoped queries. The payroll access requirement was missing from the top three. Grouping adjacent clauses from the same public document preserved context and made all three checks pass. T01 still required the third ranked chunk. This is a small development smoke test, not a general accuracy claim or a held out evaluation.

The isolated measurement found warm retrieval at 790 ms for T01, 589 ms for T02 and 498 ms for T03. Cold initialization took 87.4 seconds and indexing took 37.1 seconds. A subsequent app process, benefiting from warmed filesystem and native caches, initialized and retrieved its first question in 33.92 seconds; its next two retrievals took 67 and 72 ms. Treat these as observed runs under different warmup and host load, not a stable latency guarantee. Readiness means the disk index is valid; the first query after a restart can still load the model.

Raw data: [initial retrieval](evaluations/pdf-memory-baseline.json), [revised retrieval](evaluations/pdf-memory.json) and [runtime measurements](evaluations/pdf-memory-runtime.json). The scoped probes use one pack at a time; the live application probes below searched all three available demo packs together.

## Live HTTP meeting

Three actual HTTP clients completed the flow in room `92U4SJ`. The host transferred CEO to another member; a non CEO Start was rejected. All three preparation questions returned the expected report and the key supporting passage. Opening and closing facilitator requests completed, and the CEO skipped both windows. Three scripted typed contributions entered the transcript. The automatic minutes request quoted all three contributions and did not create a decision. A person proposed an action, all three clients voted, and the CEO committed the two approve versus one reject outcome before ending the meeting.

| Request | Total | Retrieval and prompt | Vertex round trip |
| --- | --- | --- | --- |
| preparation T01 | 35.56 s | 33.92 s | 1.64 s |
| preparation T02 | 1.70 s | 0.07 s | 1.63 s |
| preparation T03 | 1.55 s | 0.07 s | 1.48 s |
| opening_facilitator | 1.33 s | 0.00 s | 1.33 s |
| closing_facilitator | 3.77 s | 0.00 s | 3.77 s |
| automatic_minutes | 1.94 s | 0.00 s | 1.94 s |

Total time includes local queueing, retrieval, provider transport and validation. It is not GPU inference time. The first preparation request includes cold model initialization. The five later requests ranged from 1.33 to 3.77 seconds, with a median of 1.70 seconds.

The three preparation replies correctly surfaced restoration verification, the treasurer's supplier conflict and the fact that appointment alone does not provision payroll access. They are quotations and can be verbose or include adjacent section headings. The facilitator selected appropriate authored clarification questions, rather than improvising new facts. The minutes preserved exact wording and source IDs, but this does not establish performance on long, noisy or contradictory discussions. Partial coverage is labelled when a transcript exceeds the bounded prompt.

One existing fictional ElevenLabs recording was sent through the new Scribe route. It returned in 637 ms and did not auto commit. The transcript rendered IT as lowercase “it”; review remains necessary. This verifies a real provider round trip from a saved fixture, not a human microphone, accent test or browser permission flow.

All six live Vertex calls completed. This verification added US$0.30 in conservative reservations and 400 speech credits. Totals are US$1.55 of US$20 and 5,782 of 30,000 credits, leaving US$18.45 and 24,218 credits. Existing ledgers were retained. These are local reservations, not an exact provider invoice, and exclude spending outside this application.

Full source evidence is in [the live report](evaluations/roundtable.json). Reproduce with `python -m playtest.roundtable_benchmark --live-models`; adding `--allow-paid-transcription` opts into the separate 400 credit saved fixture test. These flags consume remaining allowance; do not reset ledgers.

## Practical limits

The server binds to localhost. Browser memberships are test tokens, not account authentication. Rooms live only in process memory; export the written record before restarting. Uploaded files and vectors persist locally, but room attachments do not survive that restart. New meetings preload public demos only and never inherit other rooms' uploads. The roster is fixed after Start in this prototype; production late admission requirements remain separate.

Browser visual layout, real microphone permission and audible playback were not tested through computer controls. No continuous audio capture or new spoken response generation was added to this page. Existing reusable ElevenLabs recordings remain in the audio lab. The PDF packs support preparation; their complete timed scenario branches are not implemented here.
