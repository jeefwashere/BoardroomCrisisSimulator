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

1. On the current speaker's card, click **Play this participant’s saved clip**, or use **Play this turn’s recording** in Discussion. The page selects that membership and plays its saved ElevenLabs recording.
2. After playback finishes, click **Commit caption and pass**. This commits the exact catalog caption and gives the next person the floor. Playback alone adds nothing to the transcript.
3. Repeat for the next speaker. **Stop** on the card or **Stop recording playback** in Discussion cancels playback without committing a caption. An expired lease or changed turn also prevents commitment.

The T01 script now has **nine different turns across three participants**, arranged as three cycles. It progresses through proposals, challenges, clarification and a summary rather than repeating the opening clips.

| Turn | Participant topic | What the recording raises | Saved duration |
| --- | --- | --- | --- |
| 1 | Leadership | The missing coordinator and proposed interim authority. | 15.28 seconds |
| 2 | Recovery | Suspicious activity, unconfirmed disclosure and unverified backups. | 16.81 seconds |
| 3 | Communications | Considering approved paper appointments without promising normal service. | 14.16 seconds |
| 4 | Leadership | Who would own coordination and the next review? | 12.96 seconds |
| 5 | Recovery | A review time is not a restoration promise. | 15.19 seconds |
| 6 | Communications | Separate facts from unknowns and identify the next update. | 14.58 seconds |
| 7 | Leadership | Compare a combined continuity proposal with waiting for the director. | 16.95 seconds |
| 8 | Recovery | Support remains conditional on technical verification; spoken support is not a vote. | 15.74 seconds |
| 9 | Communications | Summarize the alternatives and invite a custom response before voting. | 12.73 seconds |

The recordings total **134.40 seconds**, about two minutes and fourteen seconds. Each participant has a consistent voice across the three cycles. The progress display identifies the current scripted turn. The server accepts only the recording assigned to that numbered turn, and the script does not repeat after turn nine. Passing a turn without recording advances the script position; it does not silently submit the skipped caption.

These are fictional participant contributions, not live model replies or proof that an action has happened. Check their claims against the PDF. Playback and trusted caption commitment make no new provider request. After all nine turns, continue with typed discussion or let the CEO proceed to the advisers.

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

For the default T01 report, the server opens one shared ballot under **Choose the board’s response**. The CEO's page plays the separately labelled **RECORDED DECISION GUIDE** once when voting opens. It lasts **23.13 seconds** and explains that the group may choose a prepared response or write a custom one. **CEO: Replay recorded guide** replays it; **Stop guide** stops it. With **Speak with ElevenLabs** unchecked, its text remains available without playback.

This guide is a saved explanation of the choices. It does not generate live advice, add a contribution, vote, choose a winner or commit a result. Replaying it makes no provider request.

The three authored responses are:

| Response | Proposed action |
| --- | --- |
| Controlled continuity | Appoint an interim coordinator, authorize approved paper appointments, ask IT to verify backup usability, dependencies and an estimate before promising restoration, and issue a factual update. |
| Technical checks first | Appoint an interim coordinator, keep appointments paused until IT verifies recovery, and issue a factual update. |
| Wait for the director | Keep appointments paused and defer the interim appointment and paper process while awaiting the director. |

Read the full wording on each choice card. These are proposed actions, not claims that recovery or a downstream consequence has occurred.

1. The page asks the next member by name: “Alex, which response do you choose?” Their card shows **DECIDE NOW**. In the single window test setup, that seat is selected automatically.
2. Click **Choose this response** on a prepared or custom choice, then click **Confirm my vote**. Selecting a choice alone sends no ballot. The next member is then asked and selected automatically. Repeat for Morgan and Sam.
3. The server enforces the first vote order. Members waiting for their turn cannot submit early. Each person can change their own submitted choice before commitment by selecting an option and clicking **Confirm changed vote**. Pending choices remain private. Separate participant browsers keep their own identity and never switch seats automatically.
4. After all three confirmations, the test view returns to the CEO. Once all ballots arrive, click **CEO: Record winning response**. The option with the most ballots wins. The CEO cannot replace a clear winner with another option.
5. If leading options tie, the CEO sees **CEO tie:** buttons for those leaders and must explicitly choose one of them.
6. A live Gemini evaluation, with ElevenLabs speech when enabled, interprets the committed result. It cannot revise votes or apply an unimplemented scenario outcome.
7. Click **CEO: End meeting**, then **Export written record**. The export includes discussion and decisions without membership bearer tokens.

The T01 ballot cannot be cancelled, and the meeting cannot end while it is unresolved. It applies only when T01 is the sole attached document. Other document selections retain the earlier custom proposal and approve, reject or abstain workflow; they do not inherit T01 choices.

## Add a custom response

During the decision phase, the CEO can use **Write a custom response** below the recorded guide. Enter a **Short title** of up to 80 characters and **Your proposed response** of up to 1,500 characters, then click **Add custom option**. Up to three custom options can be added alongside the three prepared choices.

A custom response is human supplied and unverified. Adding one does not accept it, remove the prepared choices or override another participant's vote. If it later wins and the CEO records it, its exact proposal becomes the final decision text, taking precedence over the prepared plans for that committed result. The live evaluator receives this winning custom text.

Every added option changes the ballot version and clears all existing ballots. If someone has already voted, you must first check **I understand that existing votes will be cleared and everyone must vote again.** The page reports the reset and returns to the first voter. Everyone must repeat **Choose this response** and **Confirm my vote** against the updated options. Previous ballots never carry over silently.

The CEO still cannot replace a clear winner with a preferred custom option. After a tie, only a tied leader may be chosen.

## Test a custom response winning two votes to one

1. Start a fresh default T01 meeting. Play and commit all nine turns manually. Confirm that the transcript has nine distinct recorded contributions and that no tenth prerecorded turn loops back to the beginning.
2. Let the five minute discussion finish, or select the CEO and click **CEO: Finish discussion**. Consult an adviser if useful, then let the adviser minute finish or click **CEO: Finish adviser minute**.
3. Hear or read the recorded decision guide. Under **Write a custom response**, use the title **Review before paper activation**. Enter: “Appoint an interim coordinator, ask IT to verify backup usability and recovery dependencies, and return to the board with a restoration estimate before activating paper appointments. Issue a factual update distinguishing confirmed facts from unknowns.”
4. Click **Add custom option** before anyone votes. It should appear alongside the three prepared responses. Adding it must not create a committed decision.
5. As Alex, choose **Review before paper activation** and confirm. As Morgan, choose the same custom response and confirm. As Sam, choose **Technical checks first** and confirm.
6. Return to the CEO and click **CEO: Record winning response**. Expect the custom response to win two votes to one. The committed record must contain its exact proposal, not the text of Controlled continuity or another prepared plan.
7. Inspect the live evaluation and written record. The evaluator should discuss the actual custom plan, preserve uncertainty about recovery and avoid claiming that board approval made the proposed actions happen. Export the record.

This is a manual procedure and its expected result, not a claim that the live case has already passed. Actual verification belongs in [the extended conversation report](EXTENDED_CONVERSATION_REPORT.md).

## Test changing the ballot after a vote

1. Start a fresh meeting and proceed to decisions. As Alex, choose **Controlled continuity** and click **Confirm my vote**. One confirmed ballot now exists.
2. As the CEO, enter a new custom title and proposal. Leave the reset acknowledgement unchecked: the option must not be added while confirmed ballots exist.
3. Check the acknowledgement and click **Add custom option**. Expect a new ballot version, all prior ballots cleared, and Alex prompted to vote again. The previous Controlled continuity vote must not remain counted.
4. Repeat selection and confirmation for Alex, Morgan and Sam. Confirm that the CEO cannot commit before all three updated ballots arrive.
5. If you add another custom option, expect the same reset. A fourth custom addition must be refused because the limit is three custom options.

For a tie test, start a new meeting and choose a different option for each of the three members. Before commitment, the CEO must explicitly select a tied leader. A custom response has no priority over another tied choice. Neither participant audio nor the recorded guide submits ballots.

## Written minutes, usage and limits

The side panel keeps minutes next to the complete transcript. On entry to decisions, the backend requests one live minutes update when discussion exists unless a current summary already covers it. Minutes select exact contribution quotes. A partial coverage warning means only the latest contributions fitting the request were considered. Quotes are discussion evidence, not automatically verified incident facts.

The application retains **no app spending cap** for Vertex or ElevenLabs, as requested. Existing usage entries remain in both ledgers, and new requests are tracked. The page shows **Usage tracking only · no app spending cap**. Live generation and transcription can still incur provider charges.

Start requests a live introduction. Optional previews, adviser questions, minutes updates, evaluation and explicit microphone transcription also use live services. The saved participant clips and recorded decision guide make no new provider calls. Loading the page, PDF or test seats does not itself request paid generation.

Manual joining, CEO reassignment and PDF upload remain secondary controls. Changing the CEO before Start resets readiness. Uploaded PDFs stay scoped to their room. The roster freezes at Start. This is a localhost experiment with test membership tokens, not a public deployment or production account login. Restarting the backend loses rooms; export important records first.

The live harness is `python -m playtest.extended_round_benchmark --live`. Its measurements and limitations are recorded in [the extended conversation report](EXTENDED_CONVERSATION_REPORT.md); older streaming results remain in [the preparation report](STREAMING_PREPARATION.md). Browser visual quality, human microphone permission and listening quality remain unverified. HTTP and audio byte checks do not establish those results. The separate audio website remains removed.
