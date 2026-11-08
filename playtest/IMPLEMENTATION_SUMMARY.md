# Current implementation and branch handoff

Current X18 update: the default browser now runs [Round 1](ROUND_ONE_REPORT.md) of [the four round design](FOUR_ROUND_DESIGN.md), with preparation, group discussion, three experts and individual decisions without scoring. The earlier ballot implementation described below remains a legacy mode.

Working branch: **`experiment/ai-voice-playtest`** in [BoardroomCrisisSimulator](https://github.com/jeefwashere/BoardroomCrisisSimulator/tree/experiment/ai-voice-playtest). The guided round was introduced in [commit 5c1bc8f](https://github.com/jeefwashere/BoardroomCrisisSimulator/commit/5c1bc8f3a82629b8958a3e066205c2c491681e64). It is published on this side branch and has not been merged into `main`.

## What is implemented

1. One public T01 incident PDF loads automatically. A button creates three separately authenticated test participants in one window. The existing CEO role controls Start, early phase completion and final decision commitment.
2. A 30 second opening uses local Gemma PDF retrieval, Gemini Flash LOW text generation and streamed ElevenLabs speech. The participant discussion then opens for up to five minutes.
3. Participant cards show the current speaking turn and manual Play, Stop and Commit caption and pass controls. Nine distinct recordings cover leadership, recovery checks, communications and a proposed combined response, totaling 134.40 seconds. Each test participant has three turns. Clips do not loop after turn nine. Playback alone never commits a contribution or passes the turn.
4. Discussion leads to a visible 60 second consultation stage. The CEO can ask the live facilitator, IT adviser or journalist, or finish the stage early. Advisers are also available during discussion and decisions.
5. A separate recorded decision guide, about 23 seconds long, introduces custom responses and the prepared T01 choices: Controlled continuity, Technical checks first and Wait for the director. The UI asks each participant by name, offers the three choices and requires Confirm my vote. The server enforces first ballots in order; only the test view automatically selects the next member. Only the CEO can add a custom response before commitment. Adding a choice clears pending votes, requires acknowledgement if votes exist, and invalidates stale controls. The CEO records the winner after every ballot, or selects among tied leaders. A custom winner supplies the canonical decision text.
6. A live evaluation interprets the actual committed choice and tally. The server owns deadlines, turns, votes and results. Models do not cast ballots or change a result.
7. The side panel keeps the transcript, quote based minutes and committed decisions. Typed contributions work alongside explicit microphone recording, Scribe transcription, review and separate submission.
8. The separate audio website is removed. Ten additional X16 recordings are included in this branch; playback makes no provider call. Live advisers use Gemini plus ElevenLabs. App spending caps are removed as requested, with both usage ledgers preserved. Credentials, model weights and private uploaded files remain outside Git.

The prepared and custom choice ballot applies to the sole T01 document selection. Other document selections retain the earlier custom proposal flow. This does not implement every timed branch in the three original scenario fixtures.

## How to test

Open <http://127.0.0.1:8788/> while the local server is running. Refresh, load three test participants and click CEO Start. Play and commit each participant's clip, select the CEO to finish discussion, consult an adviser, then cast each participant's vote and commit the result as CEO.

[The test guide](ROUNDTABLE_GUIDE.md) contains exact control names and a concrete two to one voting test. Its [formatted local version](http://127.0.0.1:8788/roundtable-guide) is available in the app. [The README](README.md) contains the startup command and environment setup.

## Current verification

See [the X16 report](EXTENDED_CONVERSATION_REPORT.md) for the nine turn conversation, custom winner flow and current checks.

## Earlier verification and remaining limits

The implementation passed 134 playtest tests, 31 existing tests and 23 Node UI checks, plus the authored demo, syntax, asset integrity, credential and documentation checks. These are the recorded X12 checks; this summary update did not repeat paid provider calls.

An initial real provider flow completed all advisers, recordings, votes and evaluation. Later checks shortened the introduction to fit its opening. A slow third adviser was correctly cancelled at the minute deadline; all three replies are not guaranteed to fit. The latest selected adviser run was partial after a strict benchmark timing assertion, subsequently corrected. A complete controlled clock HTTP test verified the exact minute and authority flow. [The detailed report](GUIDED_ROUND_REPORT.md) preserves these distinctions and measured results.

Browser listening, visual layout and human microphone permission remain manual checks. The application is a localhost prototype; restarting its process loses rooms. This branch publication is not an Internet deployment. Teammate production modules and Velocity services were not changed.
