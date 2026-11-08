# Test all four rounds in one window

Open [the local meeting](http://127.0.0.1:8789/roundtable) and create a new room. The attached report is **Service outage and unavailable director**, about fictional Cedar Bridge Community Services. [The AI workflow](FOUR_ROUND_WORKFLOW.md) explains Gemini, ElevenLabs and document memory; [the report](FOUR_ROUND_REPORT.md) records verification and limitations.

## Start and choose the test mode

1. Refresh and click **Load 3 test participants**. Alex, Morgan and Sam have separate memberships. Alex is CEO.
2. Keep **Beta test mode** checked for fixed questions matching the saved answers. To test adaptive Gemini questions, the CEO unchecks it before Start. The setting cannot change during the exercise.
3. Keep **Speak with ElevenLabs** on for live speech, or turn it off for text only. Saved human MP3 clips are separate and optional.
4. Click **CEO: Start meeting** when the three members and PDF are ready. The live preparation agent introduces the report. After 30 seconds, discussion begins. Use **Resume audio** if the browser blocks sound.

The new browser flow is `four_rounds`. Existing rooms created in the older Round 1 or ballot experiment retain their old flow; create a fresh room to test this update.

## Round 1: shared discussion and individual decisions

Play the current speaker's saved discussion clip, wait for completion, then choose **Commit caption and pass**. There are nine distinct discussion turns, three per participant. Playback alone does not submit or pass. You can stop, type your own contribution, or explicitly record, transcribe and review microphone input.

After the clips, the CEO can finish discussion early. The five minute discussion also ends automatically. The IT/security, operations/community services and governance/finance experts respond live in sequence. Wait for all three; use **CEO: Hear next expert** if a request fails. Then select **CEO: Begin individual decisions**.

Select each member. In **Saved answer for this turn**, play that person's decision clip. After it finishes, choose **Review this answer as a draft**. Review the single answer box, check the confirmation box and submit the individual decision. The prompt asks what you would do next and why. In a few sentences, include your action, supporting information and what you still need to check. Saved clips and reviewed microphone transcripts fill this same editable box. Repeat for all three members.

Select the CEO and choose **CEO: Start private sessions**. There is no group winning ballot, CEO override or scoring in this first round.

## Round 2: one member and one crisis coach

Select Alex. Their private coach introduces the unavailable IT specialist and asks one question. Only Alex's original decision and private history are included. The selected member's first agent turn starts automatically; **Continue with my agent** or **Hear my agent again** provides manual control. Failed requests need an explicit retry.

1. Read or hear the question.
2. Play the offered saved human answer, wait, then choose **Review this answer as a draft**. Alternatively type an answer or explicitly record and transcribe your voice.
3. Review and edit the text. Check **I reviewed this answer** and click **Submit my answer**.
4. Repeat for the three coaching questions.
5. Review all seven fields of the generated response card. Correct omissions, check its confirmation box, and choose **Confirm card and begin assessment**.

Preparation earns no points. A recording never confirms its own text or card. To abandon a sample, use **Use my own answer**; the editable text stays available.

## Optional Live microphone conversation in private rounds

Use the updated server on port 8789. After the current question is ready and other audio stops, click **Start live conversation** and allow microphone access. Gemini speaks in its own native voice and listens live. You can interrupt, or use **I finished speaking** to flush your turn. Beta mode fixes the question, voice and scenario and uses temperature zero; wording can still vary.

Click **Stop live microphone**, then **Use my spoken words as an answer draft**. Correct recognition errors and remove conversational questions before confirming and submitting. Live never submits or scores an answer itself. Start again for the next question. The examiner clarifies questions without coaching or scoring feedback. Each connection is limited to two minutes; reconnect explicitly if needed. Ordinary speech buttons still use Gemini plus ElevenLabs. Read [the Live workflow](LIVE_AUDIO_WORKFLOW.md) for privacy, costs and verification.

## Round 3: the same agent becomes examiner

The transition is announced before the first assessment question. The same member and agent continue; no other expert joins.

Answer the three stages with the corresponding saved clip or your own reviewed answer. The questions ask you to explain the response, adapt to a delayed provider, then give a final instruction. Confirm and submit each answer separately. Gemini assesses the submitted evidence and the server displays cumulative points, with maxima of 30, 40 and 30.

Detailed feedback stays hidden until that member completes all three stages. A failed scoring call preserves the answer; use **Score submitted answer and continue** or the retry button. A completed member waits for the others.

Switch to Morgan and then Sam to complete their coaching and assessment. In one window these are separate selected identities; in independent participant browsers sessions can progress at the same time. Do not expect one member's decisions to alter another branch.

## Round 4: reunion, evidence review and winner

When all three finish, the shared reunion opens. Select the CEO to hear the live summary. It compares separate approaches, shows scores with supporting quotes, and identifies strengths and improvements.

1. Select each member and inspect their stage evidence.
2. To flag an overlooked passage, choose its stage and copy an exact quote from that member's existing Round 3 answer into the review field. Submit the review request. A new argument cannot earn points. A failed review can be retried with the same quote or withdrawn.
3. Use either of the two offered reunion clips per member as an optional reflection, or write your own. Play, load the editable draft, then separately submit the reflection. Reflections add no points.
4. Each member clicks **I have reviewed my results** after any correction finishes. A correction requires an updated reunion summary.
5. Select the CEO and click **CEO: Announce final winner** once enabled. Highest final Round 3 score wins; equal highest scores are joint winners.

## Records, speech and practical limits

**Export written record** contains the current member's private session and, once reunited, the shared branch comparison. **Export my preparation context** preserves the caller's Round 1 context. Other members' private answers are hidden before reunion. The single window testing bundle intentionally lets you select all three memberships.

There are 36 current exercise clips: nine discussion turns, three decisions, nine coaching answers, nine assessment answers and six reflections. They are fictional human fixtures. All AI responses use the live workflow, with canonical beta questions supplied by the server. Fixed question order improves repeatability; live wording and scoring can still vary.

The prototype enforces three members and the included T01 report. It has a 30 second opening, up to five minutes of discussion and explicit completion gates thereafter; it does not force the complete exercise into 15 minutes. Rooms are in memory and disappear on server restart. Export before restarting. Audio plays in the requesting browser, not as a synchronized call across separate browsers.

This page remains localhost only. Browser visuals, human microphone permissions and listening quality need manual review. Run the optional paid HTTP check with `python -m playtest.four_round_benchmark --live`.
