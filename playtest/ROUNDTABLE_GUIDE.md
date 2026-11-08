# Test the guided meeting in one screen

Open [the local meeting](http://127.0.0.1:8788/roundtable) while the playtest server is running. One PDF, **Service outage and unavailable director**, is attached automatically. Participants, live advisers, saved recordings, written discussion and voting stay on this page.

The sequence is **30 seconds of preparation → five minutes of discussion → one minute with advisers → recorded voting guide and explicit ballots → CEO commitment → live evaluation**. The CEO can finish discussion and the adviser minute early. Voting waits for people; it has no automatic deadline or automatic ballots.

## Start with three test participants

1. Click **Load 3 test participants**. Alex, Morgan and Sam receive separate memberships and are marked ready. Alex initially has the existing CEO role. Loading the seats makes no model or speech request.
2. Click **CEO: Start meeting**. Preparation retrieves passages from the PDF with Gemma embeddings. Gemini introduces the situation with streaming text and ElevenLabs speech.
3. The server opens discussion after 30 seconds. Everyone must be connected and ready, and document memory must be ready before Start. Model warmup can take time after restarting the server.

Uncheck **Speak with ElevenLabs** before starting for text only. **Stop agent** cancels current live generation and playback. If the browser blocks sound, press **Resume audio**. Written text remains visible. **Preview introduction** is an optional separate live request before Start.

The server controls deadlines. A slow introduction does not extend preparation; remaining introduction audio stops when discussion starts.

## Play each participant manually

The current participant card shows **SPEAKING NOW**. Others show **Waiting for turn**. Nothing plays automatically for the participants.

1. On the current speaker's card, click **Play this participant’s saved clip**. The page selects that membership and plays its saved ElevenLabs recording.
2. After playback finishes, click **Commit caption and pass**. This commits the exact catalog caption and gives the next person the floor. Playback alone adds nothing to the transcript.
3. Repeat for the next speaker. **Stop** cancels playback without committing a caption. An expired lease or changed turn also prevents commitment.

The three new T01 recordings give useful points to discuss:

| Participant topic | What the recording raises | Saved duration |
| --- | --- | --- |
| Leadership | Appointing an interim coordinator when the director is unavailable and no alternate is named. | 14.21 seconds |
| Recovery | Checking backup usability, dependencies and a restoration estimate before promising recovery. | 17.18 seconds |
| Communications | Considering approved paper appointments and separating facts, unknowns and the next update. | 14.63 seconds |

They total about 46 seconds of saved speech. These are fictional participant contributions, not live model replies or proof that an action has happened. Check their claims against the PDF. Playback and trusted caption commitment make no new provider request.

Discussion remains open for five minutes unless the CEO finishes it early. You can type additional contributions during each person's turn. Use **Next participant** to pass the floor; only the current speaker or CEO can do that.

## Type or use your microphone

Open **Type or record your own contribution**, select the current speaker, enter text and click **Commit contribution**.

For microphone input, click **Record microphone**, grant permission, speak for up to 29 seconds and click **Stop recording**. Nothing uploads until you click **Transcribe microphone**. Review and edit the provisional Scribe v2 transcript, then separately click **Commit contribution**. A speaking turn or phase change stops recording.

There is no continuous microphone capture, background meeting recording or emotion scoring. Committed text is the written discussion record.

## Use the visible adviser minute

When discussion ends, the phase changes to **One minute with live advisers**, with a 60 second countdown. The CEO can enter it early using **CEO: Finish discussion**. This ends the discussion round, not the meeting.

Select the CEO seat. In **Live advisers**, choose **Facilitator**, **IT character** or **Journalist** under **CEO consults**, then click **Ask selected agent**. Replies use live Gemini generation and live ElevenLabs speech when enabled. Stop current playback before asking another agent. Adviser consultations are also available during discussion and decisions.

Try these questions:

1. Facilitator: “Which assumptions should we clarify before choosing a response?”
2. IT character: “What must be verified before we promise a restoration time?”
3. Journalist: “What can we communicate while recovery remains uncertain?”

Open **Evidence from the report** to inspect retrieved sources. Citations help review a reply; they do not guarantee every generated sentence is correct. The adviser cannot cast a ballot or record a decision.

The minute has a hard cutoff. Three adviser replies may not fit when generation or playback is slow; choose the most useful adviser, or ask others during the main discussion.

Wait for the minute to finish, or click **CEO: Finish adviser minute** to proceed early. Any remaining adviser audio stops when its phase changes.

## Hear the guide and choose a response

For the default T01 report, the server opens one fixed ballot under **Choose the board’s response**. The CEO's page plays the separately labelled **RECORDED DECISION GUIDE** once when voting opens. It lasts 19.74 seconds. **CEO: Replay recorded guide** replays it; **Stop guide** stops it. With **Speak with ElevenLabs** unchecked, its text remains available without playback.

This guide is a saved explanation of the choices. It does not generate live advice, add a contribution, vote, choose a winner or commit a result. Replaying it makes no provider request.

The three authored responses are:

| Response | Proposed action |
| --- | --- |
| Controlled continuity | Appoint an interim coordinator, authorize approved paper appointments, ask IT to verify backup usability, dependencies and an estimate before promising restoration, and issue a factual update. |
| Technical checks first | Appoint an interim coordinator, keep appointments paused until IT verifies recovery, and issue a factual update. |
| Wait for the director | Keep appointments paused and defer the interim appointment and paper process while awaiting the director. |

Read the full wording on each choice card. These are proposed actions, not claims that recovery or a downstream consequence has occurred.

1. Select Alex's seat and click **Vote for this response** on one option.
2. Select Morgan and explicitly choose an option, then do the same for Sam. The page shows each member as voted or waiting. **Your current vote** identifies the selected seat's ballot.
3. You may change your own vote before commitment. Pending choices remain private; every member must submit a ballot.
4. Select the CEO. Once all ballots arrive, click **CEO: Record winning response**. The option with the most ballots wins. The CEO cannot replace a clear winner with another option.
5. If leading options tie, the CEO sees **CEO tie:** buttons for those leaders and must explicitly choose one of them.
6. A live Gemini evaluation, with ElevenLabs speech when enabled, interprets the committed result. It cannot revise votes or apply an unimplemented scenario outcome.
7. Click **CEO: End meeting**, then **Export written record**. The export includes discussion and decisions without membership bearer tokens.

The fixed T01 ballot cannot be cancelled or replaced with a custom proposal, and the meeting cannot end while it is unresolved. It applies only when T01 is the sole attached document. Other document selections retain the earlier custom proposal and approve, reject or abstain workflow; they do not inherit T01 choices.

## A concrete voting test

Use the default report and manually play all three participant clips, committing each caption. As CEO, finish discussion early if desired. Ask the IT character a question during the adviser minute, then continue to voting.

Choose **Controlled continuity** as Alex, **Controlled continuity** as Morgan and **Technical checks first** as Sam. As CEO, record the winner. Expect Controlled continuity with two ballots, Technical checks first with one, and a committed result marked approved. Check that evaluation describes this selected plan and preserves the uncertainty about restoration; approval does not mean recovery has happened.

For a tie test, start a new meeting and choose a different option for each of the three members. Before commitment, the CEO must choose among the three tied leaders. Do not expect the recording or AI to submit any ballot.

## Written minutes, usage and limits

The side panel keeps minutes next to the complete transcript. On entry to decisions, the backend requests one live minutes update when discussion exists unless a current summary already covers it. Minutes select exact contribution quotes. A partial coverage warning means only the latest contributions fitting the request were considered. Quotes are discussion evidence, not automatically verified incident facts.

The application retains **no app spending cap** for Vertex or ElevenLabs, as requested. Existing usage entries remain in both ledgers, and new requests are tracked. The page shows **Usage tracking only · no app spending cap**. Live generation and transcription can still incur provider charges.

Start requests a live introduction. Optional previews, adviser questions, minutes updates, evaluation and explicit microphone transcription also use live services. The saved participant clips and recorded decision guide make no new provider calls. Loading the page, PDF or test seats does not itself request paid generation.

Manual joining, CEO reassignment and PDF upload remain secondary controls. Changing the CEO before Start resets readiness. Uploaded PDFs stay scoped to their room. The roster freezes at Start. This is a localhost experiment with test membership tokens, not a public deployment or production account login. Restarting the backend loses rooms; export important records first.

The live harness is `python -m playtest.guided_round_benchmark --live`. Its measurements and limitations are recorded in [the guided round report](GUIDED_ROUND_REPORT.md); older streaming results remain in [the preparation report](STREAMING_PREPARATION.md). Browser visual quality, human microphone permission and listening quality remain unverified. HTTP and audio byte checks do not establish those results. The separate audio website remains removed.
