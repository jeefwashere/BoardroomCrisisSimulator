# Test the meeting in one screen

Open [the local meeting](http://127.0.0.1:8788/roundtable) while the playtest server is running. One PDF, **Service outage and unavailable director**, is attached automatically. Participants, live agents, prerecorded voices, transcript, minutes and decisions stay on this page.

## Two click quick start

1. Click **Load 3 test participants**. Alex, Morgan and Sam receive separate test memberships and are marked ready. Alex initially has the existing CEO role. This step makes no paid model or speech calls.
2. Click **CEO: Start meeting**. The preparation agent automatically introduces the report with streaming text and ElevenLabs speech. The server opens a 30 second preparation window, then starts a five minute discussion. You do not need to press Preview introduction first.

Start requires three connected members, everyone ready, and document memory ready. If Start is unavailable, read the readiness message. Model warmup can take time after a server restart. The clock belongs to the server: a slow introduction does not extend the preparation window, and any remaining introduction audio stops when discussion starts.

Uncheck **Speak with ElevenLabs** before starting for text only. **Stop agent** cancels ongoing generation and playback. If the browser blocks automatic audio, press **Resume audio**. Text remains visible. The optional **Preview introduction** button is a separate paid request available in the lobby; it is unnecessary for the quick start.

## Hear the three test participants

Each participant card shows **SPEAKING NOW** or **Waiting for turn** under the person's name. You control every participant manually. Only the current speaker can play and commit their assigned clip.

1. Under the current speaker's name, click **Play this participant’s saved clip**. The page selects that membership and plays its fixed ElevenLabs MP3. It does not generate speech or run transcription.
2. Wait for playback to finish. Click **Commit caption and pass** on that card to record the exact trusted caption and give the floor to the next member. Playback alone adds nothing to the transcript.
3. Look for **SPEAKING NOW** under the next person's name, then choose when to play their clip. Nothing plays automatically. **Stop** cancels playback without committing an interrupted caption. A changed turn or expired playback also prevents commitment.

Exactly three saved clips are available here, one for each test participant. They are fixed fictional participant contributions. Treat their claims as discussion input and check them against the PDF; a committed caption is not automatically a verified incident fact. There is no prerecorded AI agent selector. Preparation, facilitator, IT, journalist, decision guidance and evaluation use live Gemini responses, with live ElevenLabs speech when enabled, grounded in the report, discussion and committed decisions as applicable.

After you manually play and commit the clips, discussion continues until its five minute deadline or the CEO finishes early. You can also type or record an additional contribution during the current person's turn.

## Type or use your microphone

Open **Type or record your own contribution**. Select the current speaker, enter text and click **Commit contribution**. Use **Next participant** when that speaker is finished. The current speaker or CEO can pass the floor.

For actual speech input, click **Record microphone**, grant browser permission, speak for up to 29 seconds and click **Stop recording**. The audio stays local until you explicitly click **Transcribe microphone**. Review and edit the provisional Scribe v2 text, then click **Commit contribution** separately. Recording stops if the speaking turn or discussion phase changes.

There is no continuous microphone capture, background meeting recording or emotion scoring. Committed text forms the written discussion record. Microphone transcription and live agent speech are separate operations.

## Consult the live agents and finish discussion early

Select the CEO seat. During discussion or the decision phase, choose **Facilitator**, **IT character** or **Journalist** in **CEO consults**, type a question and click **Ask selected agent**. These are live Gemini replies based on the available report and discussion, streamed as text and live ElevenLabs speech when enabled. Stop current playback before starting another agent.

Try these questions:

1. Facilitator: “What assumption should we clarify before making a decision?”
2. IT character: “What does the report establish about service recovery, and what remains unknown?”
3. Journalist: “What could we communicate without claiming an unverified restoration time?”

The CEO can click **CEO: Finish discussion** at any time during discussion to enter decisions early. This does not close the whole meeting. The CEO can still consult the three agents before voting. There are no separate opening or closing facilitator minutes in this version.

Preparation questions are available before and during the short preparation window. Gemma retrieves report passages, and Gemini Flash LOW writes advisory prose from the scoped evidence. Open **Evidence from the report** to inspect the sources. Citations do not guarantee that every generated sentence is correct, and agent prose never changes a vote or records a decision.

## Review, vote and evaluate

On entry to decisions, the CEO's screen automatically requests decision guidance once. The backend also requests one AI minutes update when discussion exists, unless a current summary already covers it. These are separate paid operations. Failed automatic guidance is not repeatedly retried by the page.

The side panel keeps written minutes next to the full transcript. Minutes select exact contribution quotes; they are not a synthesized factual recap. A partial coverage warning means only the latest contributions fitting the bounded request were considered. The full transcript remains available. Suggested problems are prompts for human review, not approved proposals.

1. Choose a suggested problem or write your own. Enter an explicit proposal and select its discussion evidence.
2. Click **Submit explicit proposal**. Repeat for additional problems if needed.
3. Select each test seat and vote **approve**, **reject** or **abstain**. Every member has one ballot for each proposal.
4. Return to the CEO. After all ballots arrive, click **CEO: Record result**. An approve/reject tie with positive votes requires an explicit CEO tie choice. All abstentions reject the proposal.
5. A new approved or rejected decision automatically triggers an advisory evaluation of that actual committed result. It does not revise the result, invent a new vote or apply an unimplemented scenario consequence.
6. Resolve or explicitly cancel every pending proposal, then click **CEO: End meeting**. Use **Export written record** to save discussion, evidence, decisions and job information without membership bearer tokens.

## A concrete decision test

During Alex's discussion turn, type and commit this contribution, then pass the floor:

```text
We need an owner to verify the current service status before anyone promises a restoration time. I propose that Morgan checks the report and reports confirmed facts and unknowns to the group before 3 PM.
```

Morgan can commit “I can own that check and report the remaining unknowns.” Sam can commit “Please keep any public statement separate from an unverified recovery estimate.” Pass the floor after each typed contribution, or let the CEO finish discussion early.

In decisions, select Alex's contribution as evidence and enter:

```text
Problem: Who owns verification of service status before a public update?
Proposal: Morgan will check the available report and report confirmed service facts and remaining unknowns to the group before 3 PM. No restoration time will be presented as confirmed without evidence.
```

Vote approve as Alex, approve as Morgan and reject as Sam. Select the CEO and record the result. Expect **approved**, two approve votes and one reject vote, followed by an evaluation tied to that decision. This is a proposed test action, not a factual assertion that recovery has happened. Check that the evaluation preserves that distinction.

For a second proposal, try approve, reject and abstain. The CEO should need an explicit tie choice. Do not expect AI to cast any of these ballots.

## Usage tracking and practical limits

The application now has **no app spending cap** for Vertex or ElevenLabs, as explicitly requested. Existing usage ledger entries are preserved, and new requests remain tracked. The page shows **Usage tracking only · no app spending cap**. Provider usage can still incur charges; this change removes the application's credit gating rather than making generation free.

CEO Start, decision guidance and evaluation request live generation at the actions described above. Optional consultations, previews, minutes refreshes and explicit microphone transcription also use live services. Saved participant clip playback and trusted caption commitment make no new provider requests. Loading the page, PDF or test participants does not itself request paid generation.

Short agent replies, bounded evidence, queue controls and the 29 second microphone capture limit remain format and resource safeguards. They are not spending caps. Usage estimates and measured timings are reported separately in the verification report.

Manual joining, CEO reassignment and PDF upload are secondary controls. The host may assign the CEO before starting, which resets readiness. Uploaded PDFs are scoped to their room. A new room does not inherit another room's private uploads.

This is a localhost experiment with test membership tokens, not a public deployment or production account login. The roster freezes at Start. Browser refresh can preserve membership while the backend lives; restarting the backend loses active rooms. Export important records first. Browser audio playback, human microphone permission and visual layout remain manual checks unless separately verified. Automated streaming checks establish arrival order and playable bytes, not listening quality.

See [the streaming verification report](STREAMING_PREPARATION.md) for measured timings, checks and limitations. No separate audio website is required; the old audio lab route is no longer served.
