# Test Round 1 in one window

Open [the local meeting](http://127.0.0.1:8788/roundtable). The new default is Round 1 of [the four round design](FOUR_ROUND_DESIGN.md). One PDF, **Service outage and unavailable director**, loads automatically. It describes fictional Cedar Bridge Community Services, not MapleCart.

## Start and hear the preparation agent

1. Refresh the page and click **Load 3 test participants**. Alex, Morgan and Sam receive separate memberships. Alex starts as CEO.
2. Click **CEO: Start meeting**. The preparation agent still opens the meeting. Gemma retrieves the report passages, Gemini introduces the situation, and ElevenLabs streams the speech while text appears.
3. After 30 seconds, participant discussion opens. If the browser blocks sound, use **Resume audio**. **Stop agent** cancels output. Uncheck **Speak with ElevenLabs** for text only.

The selected PDF and all members must be ready before Start. Loading the report or test seats makes no paid generation request. **Preview introduction** is an optional additional live request.

## Discuss using nine manual recorded turns

Each participant has three scripted turns. Click the current speaker's **Play this participant’s saved clip**, wait for it to finish, then click **Commit caption and pass**. Playback alone does not submit text or pass the turn. **Stop** discards the playback without committing.

The first seven clips discuss leadership, recovery uncertainty, community appointments and communication. The revised final two clips ask for expert perspectives and prepare each member to write their own response. They no longer tell participants to cast a winning board ballot. These are labelled fictional recordings, not live agent replies or real member speech.

After turn nine, the script does not repeat. Continue typing or use **CEO: Finish discussion** to proceed. The discussion also ends automatically at five minutes. **Next participant** passes the floor without committing a recording.

Typed contributions and explicit microphone transcription remain available under **Type or record your own contribution**. Record locally, stop, request transcription, correct the provisional text, then separately commit. There is no continuous microphone capture.

## Hear three experts respond to the discussion

After discussion, three live perspectives run in sequence in the CEO's window:

1. **IT / security:** technical facts, uncertainty and verification.
2. **Operations / community services:** staff, service users, continuity and dependencies.
3. **Governance / finance:** authority, responsibilities and resources, without invented policies or spending limits.

Each response uses the selected report and recent shared discussion. The current request includes up to eighteen contributions, each bounded to 400 characters. The full transcript remains available separately. The expert cards preserve completed replies and source references for everyone in the room. Streaming sound plays in the requesting browser; this is not a synchronized audio conference across separate browsers.

This stage waits for all three completed perspectives. It does not silently advance when a model fails. As CEO, use **CEO: Hear next expert** to retry an incomplete request. Retrying a live provider request may incur a new charge. The completed perspectives are not regenerated automatically.

Then click **CEO: Begin individual decisions**. Members can ask the facilitator during the group session using **Ask selected agent**. AI advice cannot submit a decision or award points.

## Each member submits their own decision

Select a participant card. Fill in all four fields:

1. **I would do this:** your proposed action.
2. **For these reasons:** why you chose it.
3. **Using this information:** evidence from the report, discussion or expert advice. Distinguish suggestions from verified facts.
4. **I still need to establish:** unknowns and assumptions to check.

Check the confirmation box, then click **Submit my individual decision**. Repeat under each of the three test memberships. Each member may revise their own response until Round 1 closes. Fields are saved as drafts while switching test seats in the same page; unsubmitted drafts are not durable across a reload.

For spoken answers, expand **Speak your decision instead**, choose the target field, click **Record answer**, then **Stop recording** and **Transcribe and review**. Correct the text before confirming and submitting. Neither recording nor transcription submits a decision.

There is no winning vote, CEO override, score or leaderboard in this Round 1 mode. The CEO sees submission status but cannot write another member's response through their own membership. The single window test view explicitly holds three separate memberships so you can test all three yourself. Separate participant browsers receive only their own decision content.

## Finish and inspect the saved context

After all members submit, select the CEO and click **CEO: Complete Round 1**. Individual responses then become read only.

Select a member and click **Export my preparation context**. The export contains the selected documents, opening preparation, shared discussion, expert perspectives, that member's contributions and their own individual decision. Other members' individual decisions are excluded. No private coaching agent starts yet.

**Export written record** also saves the shared transcript and current member's decision. The right panel keeps quote based AI minutes alongside the full transcript. Minutes can be partial or stale and are labelled accordingly.

## What is implemented and what is planned

Round 1 is implemented. Rounds 2 and 3 remain planned private conversations with one coach becoming the examiner. Round 4 reunion, assessment scores, appeals and winner announcement are also planned. No twist is released during this group round, and no score is fabricated.

The full design proposes a 15 minute exercise. This prototype keeps the existing 30 second opening and up to five minutes of discussion, then waits for experts and individual submissions. It does not enforce a five minute total for Round 1 yet.

The earlier CEO custom ballot experiment remains in the backend under `flow: legacy`. New browser rooms explicitly use `flow: board_round1`. The old voting recordings remain on disk and are not played in the new flow.

The application is local, uses test memberships, and stores rooms in process memory. Restarting the server loses rooms. Both paid usage ledgers remain unlimited as authorized, with reservations retained. Credentials are never included in exports.

[Implementation and verification](ROUND_ONE_REPORT.md). Repeat the live provider check with `python -m playtest.round_one_benchmark --live`. Browser visuals, human microphone permissions and listening quality still require manual review.
