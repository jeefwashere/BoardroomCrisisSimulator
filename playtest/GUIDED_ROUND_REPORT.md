# Guided T01 meeting

The current test runs at <http://127.0.0.1:8788/>. [The guide](ROUNDTABLE_GUIDE.md) gives the exact controls. One public T01 PDF is attached automatically. Load three test participants and let the CEO start.

## Sequence and authority

1. Preparation speaks live through Gemini and ElevenLabs during a 30 second opening. Gemma retrieval supplies only the room PDF passages.
2. Participant discussion lasts up to five minutes. Play the new clips manually beneath each participant, then use Commit caption and pass. A clip finishing does not pass the turn. The CEO can finish discussion early.
3. A visible 60 second consultation stage opens. The CEO can ask the live facilitator, IT adviser or journalist, or finish this minute early. Responses are deliberately brief. The minute is a hard cutoff, so network and playback delays may prevent all three advisers from fitting. Advisers are also available during the main discussion.
4. The recorded decision guide introduces three fixed response choices. Each participant explicitly selects their own option. The CEO commits the option with the most votes after everyone votes; a tie requires an explicit choice among the tied leaders.
5. The live evaluation receives the actual committed option, canonical proposal and tally. It explains possible tradeoffs without rewriting the result.

The three choices are Controlled continuity, Technical checks first and Wait for the director. They are potential board actions based on the public T01 pack, not hidden future outcomes. The fixed ballot applies only when T01 is the sole selected document. Other document selections retain the existing custom proposal flow. The server prevents custom text from replacing these fixed options, cancellation that bypasses the ballot, premature commitment, and a CEO override of a unique winner. No model casts a human vote.

## Newly generated recordings

| Recording | Duration | Purpose |
| --- | --- | --- |
| Leadership contribution | 14.21 seconds | Raise the missing alternate coordinator and propose an interim appointment |
| Recovery contribution | 17.18 seconds | Separate suspicious activity from confirmed disclosure and request recovery verification |
| Communications contribution | 14.63 seconds | Discuss paper appointments and a factual public update |
| Recorded decision guide | 19.74 seconds | Read the fixed choices and explain explicit voting |

The three participant clips total 46.02 seconds. All four files were generated with ElevenLabs Flash v2.5 using three standard voices at request concurrency two. Generation added 1,042 conservative credit reservations to the existing ledger. Existing recordings were retained without regeneration. Repeating the selected generation command reused all four assets without another call. [Generation evidence](evaluations/t01-recordings.json) contains scripts, source grounding, durations and hashes.

Participant clips require the active speaking turn and a separate caption commit. The decision guide has its own authenticated playback route, labelled as recorded, and cannot enter the participant transcript or ballot. Its playback uses no provider call. It can be stopped or replayed by the CEO. Other advisers and evaluation remain live Gemini plus ElevenLabs; no prerecorded reply replaces them. Both spending ledgers retain unlimited application authorization and prior usage history.

## Validation

Automated verification passed 134 playtest tests, 31 existing tests and 23 Node UI checks. The authored demo, syntax, credential scan, current documentation links, unchanged old recording entries and four new audio hashes also passed.

Two development runs are retained: [the initial complete flow](evaluations/guided-round-baseline.json) exposed an introduction exceeding the opening and adviser speech exceeding the minute; [the shorter prompt stress test](evaluations/guided-round-timeout.json) verified the revised introduction but a slow third adviser request was cancelled when the consultation minute expired. No text or audio from that cancelled journalist request reached the test client. The final smoke flow tests one selected adviser within the minute; it does not claim three replies always fit.

The initial real provider round completed all three advisers, the recorded guide, explicit ballots and a live evaluation of Controlled continuity winning two votes to one. The recorded guide and participant playback added no provider reservation. The revised preparation produced 23.82 seconds of audio with first audio at 2.11 seconds in the stress check, and 24.52 seconds with first audio at 2.85 seconds in the later selected adviser run. Both fit the 30 second opening. The revised IT response preserved all three recovery prerequisites and kept restorability unknown.

The later [selected adviser run](evaluations/guided-round.json) is explicitly partial: after all three participant recordings, the benchmark rejected the consultation snapshot because it demanded at least 59 seconds remaining after a network round trip. That brittle lower bound was corrected. This was not a failed ballot or evidence of an incorrectly configured phase duration. A complete HTTP integration test with real recorded assets, a controlled clock and fake inference then verified exactly 60 seconds, recorded prompt playback, no automatic votes, two to one commitment and the actual winning proposal supplied to evaluation. It does not replace live latency evidence.

The first live facilitator phrased proposed paper continuity as immediate restoration. The revised prompt requests conditional language; a subsequent response used would and could. This small sample does not guarantee future response quality. Choosing a plan records board authorization, not proof that appointments or IT recovery have already resumed.

The live tests use three authenticated HTTP clients and check actual audio bytes and elapsed durations. They do not control a browser or prove that a human heard recordings. Browser speaker playback, microphone permissions and visual layout remain manual checks.

The app remains a localhost prototype on the experimental branch, not a production deployment. Rooms are kept in process memory and restarting the server starts fresh rooms. No Velocity service or teammate production module was changed.
