# Roundtable test guide

Open [the meeting](http://127.0.0.1:8788/roundtable) or [the readable HTML guide](http://127.0.0.1:8788/roundtable-guide) while the local playtest server is running.

This is an isolated meeting experiment. It adds document preparation, a written discussion and explicit decisions. It does not replace the production multiplayer scenario engine or its voting rules.

## A quick test in one window

1. Click **Create 3 test seats in this window**. Alex, Morgan and Sam receive separate server memberships. Alex initially has the existing CEO role. Selecting another seat changes whose actions you submit; it does not simulate a model or a real participant.
2. Check the document cards. The demo PDFs are shared participant materials. Wait for **Indexed**. You can download each PDF. Before starting, the host or CEO may add a PDF of up to 5 MB; indexing must finish before Start.
3. Ask preparation a question about a document. Check its answer against the displayed document title, page and cited excerpt. Gemma embeddings retrieve passages; Gemini Flash LOW selects the quoted passages for the response. A citation is evidence to inspect, not a guarantee that the answer is correct.
4. Click **Test only: mark all 3 ready**, or select each seat and click **I am ready**. This is explicit test control of three members. At least three connected, ready members and an indexed document set are required.
5. As the CEO, click **Start meeting**. A one minute opening facilitator window begins. Ask a question if useful, or click **CEO: Skip facilitator minute**. No AI response is required to continue.
6. During the three minute discussion, select each seat, type a contribution and click **Commit contribution**. Try: “Morgan will check the backup evidence before 3 PM.” Then: “We need an owner for the public update.” Then: “Which facts are confirmed, and which remain unknown?” Written contributions appear in the shared transcript with their source IDs.
7. Let the discussion timer end, or use **CEO: Finish discussion**. A second optional one minute facilitator window follows. Ask a closing question or skip.
8. Entering decisions requests one automatic AI minutes update when there is a transcript. The sidebar shows exact contribution quotes selected by AI, not a synthesized factual recap. Only one automatic minutes request is queued on entering decisions, unless a current manual summary already covers the transcript. A partial coverage warning means only the latest contributions fitting the bounded model request were considered; the full transcript remains available. A manual refresh is available for the shared Vertex budget. The full committed transcript remains available if AI fails.
9. Select an advisory decision prompt, or write a problem yourself. Enter an explicit proposal with an owner and timing. Check the discussion evidence that supports it, then click **Submit explicit proposal**. Prompts do not commit a proposal automatically.
10. Select all three test seats in turn and vote approve, reject or abstain. Return to the CEO and click **Record result** after all ballots arrive. A positive approve/reject tie requires an explicit CEO tie choice. Repeat for another problem if needed.
11. Resolve or explicitly cancel every pending proposal, then select the CEO and click **End meeting**. Export the written record. The JSON contains discussion, citations, jobs and decisions, without membership bearer tokens.

## Real people using separate windows

One person creates a room with their name and an empty room code. Other people enter their own names and that room code. Each person explicitly marks ready. The host can assign the CEO before starting. Only the CEO starts, skips facilitator windows, finishes discussion early, commits results and ends the meeting. The host and CEO can be different members.

This is test membership, not production account login. A name alone is not proof of identity. Memberships are held in the current tab session. Refresh can reuse the saved token while the backend process lives. The room roster is frozen when the meeting starts; this prototype does not admit late members into the current meeting. Backend restarts lose active rooms. Localhost links work on the machine running the server, not other people's computers without a separately configured deployment.

## Explicit microphone transcription

1. During discussion, select the speaking test seat and click **Record microphone**. Browser permission is required. Capture is local and stops after at most 29 seconds, or when you press Stop or leave the discussion phase.
2. Click **Transcribe · 400 credits** to explicitly upload that short WAV for ElevenLabs Scribe v2. This reserves 400 speech credits under the shared cap.
3. Review and edit the provisional transcript. Click **Commit contribution** separately. Neither recording nor transcription commits discussion automatically.

No continuous meeting audio, background microphone recording, emotion analysis or raw audio archive is provided here. Written contributions form the meeting record. This page does not automatically synthesize speech. Existing prerecorded ElevenLabs voices remain available in the separate [audio lab](http://127.0.0.1:8788/audio-lab).

## Agents and authority

| Component | Responsibility |
| --- | --- |
| Gemma embedding memory | Index participant PDF passages and retrieve source chunks for preparation. |
| Preparation agent | Select scoped retrieved PDF passages that address the question and return exact quotations with citations. |
| Facilitator | Select authored clarification prompts during the opening and closing windows. |
| Minutes agent | Select exact contribution quotes and suggest discussion grounded decision prompts. No synthesized factual recap is produced. |
| ElevenLabs Scribe v2 | Transcribe explicitly submitted short microphone clips into provisional text. |
| Backend | Enforce CEO permissions, readiness, phases, deadlines, memberships, votes and final decisions. |

Text agents use the approved Gemini Flash LOW Vertex experiment. The UI displays the configured model and current budget. Total local reservation caps are 30,000 ElevenLabs speech credits and US$20 Vertex; reservations persist across restarts and are shared with the other playtest pages. Preparation, facilitator and manual minutes buttons make live paid requests. Entering the decision phase requests one automatic minutes job when discussion exists. Typing, voting, downloading existing PDFs and exporting a record do not make speech or text generation calls.

## What to check

1. A non CEO cannot start or skip. Start stays unavailable while somebody is not ready or indexing is unfinished.
2. Preparation citations point to pages in the available PDF, and unrelated or missing facts are not invented.
3. Skipping both facilitator windows still allows a complete discussion and decision flow.
4. Microphone text is provisional until explicitly committed, and is attributed to the selected member.
5. AI minutes cite actual transcript IDs. Suggestions stay distinct from committed decisions. Verify any omitted discussion by reading the full transcript.
6. Every proposal needs explicit human ballots. AI cannot cast votes, assign the CEO, close a meeting or silently record a decision.
7. A proposal with two approve votes and one reject vote is approved when the CEO records it. An approve/reject tie with one abstention requires the CEO to choose. All abstentions reject the proposal.
8. Exported JSON has no authentication token. Provider latency in jobs includes transport and queueing; it is not pure model inference time.

Browser microphone permissions, human listening quality and visual layout still need manual verification. Automated API checks establish server behavior, not these browser or human judgments.
