# Extended conversation and custom voting

Branch: `experiment/ai-voice-playtest`. X16 expands the single window T01 meeting at <http://127.0.0.1:8788/>. The report is **Service outage and unavailable director**, about fictional Cedar Bridge Community Services. These recordings belong to that PDF, not the MapleCart retail incident.

## New recorded conversation

Nine newly generated ElevenLabs Flash v2.5 participant clips provide **134.40 seconds** of speech. Each of the three test participants has three turns. The discussion develops a response through questions, uncertainty, objections and a combined proposal instead of repeating three isolated statements.

| Turn | Test participant | Duration | Subject |
| --- | --- | --- | --- |
| 1 | Alex | 15.28s | Leadership gap and interim authority |
| 2 | Morgan | 16.81s | Unverified backups and required technical checks |
| 3 | Sam | 14.16s | Authorized paper appointments |
| 4 | Alex | 12.96s | Review ownership and accountability |
| 5 | Morgan | 15.19s | Review time versus restoration promises |
| 6 | Sam | 14.58s | Factual public updates |
| 7 | Alex | 16.95s | Combined response proposal |
| 8 | Morgan | 15.74s | Conditional support without an automatic ballot |
| 9 | Sam | 12.72s | Compare responses and cast individual votes |

A separate **21.97 second** recorded voting guide explains the prepared choices, custom response and explicit individual ballots. It does not cast votes or enter the participant transcript. Preparation, advisers and result evaluation remain live Gemini plus ElevenLabs.

Each turn shows its assigned recording. Click Play, wait for completion, then Commit caption and pass. Playback alone does not pass the turn. Stopping does not commit it. Turn ten offers typed discussion instead of looping old clips. The CEO can finish discussion before the five minute deadline and skip the consultation minute.

The ten new recordings reserved 2,609 conservative speech units at generation. This is a local reservation measure, not a verified provider invoice. Existing files and ledger rows are retained. Playback uses saved assets and makes no speech generation request. App budgets remain unlimited as authorized. Scripts, durations and hashes are in [the recording evidence](evaluations/t01-dialogue-recordings.json).

## Custom response and authority

At decision time, any eligible member can enter a title and proposal in the custom response form. A ballot supports three prepared choices and up to three custom responses. The custom option appears beside the prepared choices and can replace them as the final decision when it wins.

Adding an option restarts pending voting. If someone has already voted, the form requires explicit acknowledgement that existing votes will be cleared. Every member reviews the revised ballot and confirms their own vote. Stale selections and confirmations are rejected using the ballot revision. The CEO records the winner after all votes, or chooses among tied leaders. The CEO cannot replace a clear winner unilaterally.

The server saves the winning proposal from its own ballot, not from a client supplied commitment body. Gemini evaluates that exact proposal and tally. Human proposals remain labelled unverified; they cannot become scenario facts or model instructions.

## Reproduce the UI test

1. Refresh the local app and load three test participants into a new room. Start as CEO.
2. Use each current speaker's Play and Commit caption and pass controls through all nine turns.
3. Finish discussion as CEO, consult advisers if wanted, then finish the consultation minute.
4. Add a custom title and proposed response. Each member chooses a response and clicks Confirm my vote.
5. Give the custom response two votes and a prepared response one. Commit as CEO and check the recorded proposal and live evaluation.
6. In another pending ballot, cast one vote before adding a custom response. Confirm the reset, check zero votes, then have everyone vote again.

[The full guide](ROUNDTABLE_GUIDE.md) and [formatted guide](http://127.0.0.1:8788/roundtable-guide) describe exact controls. The repeatable real HTTP check is `python -m playtest.extended_round_benchmark --live`. It uses the shared ledgers for automatic minutes and a real text evaluation; preparation and adviser calls are omitted in that probe.

## Verification

141 playtest Python tests, 31 existing prototype tests and 33 Node UI tests passed. The authored offline demo and JavaScript syntax also passed. Checks cover nine distinct recordings, no tenth replay, manual commit, option bounds, vote reset acknowledgement, stale revisions, individual first vote order, custom winners and custom ties. UI tests cover changed identities and stale confirmations.

The [real HTTP run](evaluations/extended-round.json) completed all nine clips and exact caption commitments, rejected a custom addition without reset acknowledgement, cleared the prior ballot after acknowledgement, rejected an old revision and an out of order first vote, then committed the custom response **Continuity with a board review** by two votes to one. Its exact proposal reached the live evaluator. The meeting ended successfully. Shared speech reservations did not change during replay.

The real text evaluation returned its first text in **4.25 seconds** and completed in **5.53 seconds**, including local retrieval and provider time. It correctly identified the chosen custom plan, kept proposed actions conditional and compared continuity with technical uncertainty. It did not claim that systems were restored. Its comments about manual operational burdens and pausing appointments protecting data are broader advisory inferences, not established PDF facts; the latter lacks a demonstrated causal link. It also did not explicitly restate every part of the proposal, such as the next update time. This single example is a successful integration check with these quality limits, not proof of general response quality.

Audio hashes, preservation of all 40 previous manifest entries, 91 DOM IDs, guide copies, current documentation links, credential pattern scan and whitespace checks passed. The live check fetched actual MP3 bytes and waited their durations; it did not play them through a browser or verify human listening.

The application remains a localhost prototype and this feature branch is not merged into main. Rooms remain in process memory. No Velocity service or teammate production module was changed. HTTP audio retrieval and duration enforcement are checked; human listening quality, browser visuals and microphone permissions remain manual checks.
