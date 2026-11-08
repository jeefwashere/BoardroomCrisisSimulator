# Test Alex with the complete recorded sequence

X24, branch `experiment/ai-voice-playtest`. Open [the current local app](http://127.0.0.1:8792/roundtable) and select **Load Alex only**. This creates one real test membership. Morgan and Sam are not created and do not block progress. Existing rooms remain on their previous servers; use a fresh room for this mode.

## Start and reach Round 2

1. Leave **Beta test mode** selected so the questions match the recordings. The included PDF is **Service outage and unavailable director**, about Cedar Bridge Community Services.
2. Choose **CEO: Start meeting**. The preparation agent still introduces the report. You may skip the introduction or finish discussion early.
3. Alex has three saved Round 1 discussion turns under participant controls. Play each and explicitly commit its caption and pass. Live speaking is optional. These discussion clips remain manually controlled.
4. Hear the three experts, then begin individual decisions. Only Alex submits a decision. You can use the saved decision answer as an editable draft; review it and confirm.
5. Click **CEO: Start Round 2**. No Morgan or Sam answers are needed.

## Run the saved conversation

1. Find the **saved response sequence** panel. Read the three question and answer pairs and check the approval box. These are fictional beta answers, not claims that you personally spoke.
2. Click **Run my saved responses**. The agent asks the current question, the matching recorded answer plays into Gemini Live, and its live response plays. The sequence advances through all remaining clips in order.
3. Each fully played clip submits its approved trusted caption as a scripted answer. The real recognized transcript is retained separately. The microphone stays off. No new ElevenLabs recording is generated for playback.
4. After coaching clip three, playback stops. Review the response card and explicitly confirm it to start Round 3. The sequence does not confirm this card for you.
5. Review and approve the three assessment answers, then run again. It plays each answer, hears the live reply, and scores the submitted answer before advancing.
6. After assessment clip three, it stops at your own results. There is no other member to wait for, no looping back to clip one and no automatic feedback speech. Use **Hear my feedback**, review your results, then **Finish my test** when ready. A single member test has no competition winner.

**Stop sequence** stops playback and prevents remaining answers from being submitted. Already submitted answers stay saved. A retry starts at the current unanswered step, not at the beginning. Provider failures require an explicit retry. If a scoring request fails, use the existing scoring button before continuing the remaining sequence. Browser audio permission may require **Resume audio**.

The three member group option remains available. Its existing individual review and shared completion requirements are unchanged. Adaptive mode also remains available, but the automatic saved sequence requires beta mode so the supplied answers match the fixed questions.

## AI and recording files

1. `static/solo-sequence.js` coordinates the finite browser sequence and Stop.
2. `four_rounds.py` enforces approved solo submissions, completed playback receipts, revisions and completion gates.
3. `live_audio.py` sends the actual saved audio to Gemini Live, preserves recognition and records completion. Private Live responses use native Gemini audio. Ordinary preparation, expert and feedback speech still uses Gemini plus ElevenLabs.
4. `fixtures/four-round-audio.json` maps participant, round and step to each caption and recording. `recordings/` stores the existing MP3s; `recordings/manifest.json` holds their hashes.
5. The existing three Alex coaching recordings and three Alex assessment recordings are reused. Models cannot approve the response card or choose participant decisions.

## Verification

Automated checks cover one membership, isolation, required decisions, incomplete clip rejection, approval, ordered playback, stopping midway, the card boundary and completion without other members. The opt in real provider check is `python -m playtest.solo_sequence_benchmark --live`; its report is [solo-sequence-live.json](evaluations/solo-sequence-live.json). Browser appearance and human listening are separate manual checks.

Automated verification: 170 playtest Python tests, 57 Node UI checks, 31 existing prototype tests and the authored demo pass. All 80 recording hashes are unchanged. The initial live check completed the three coaching exchanges but stopped at a benchmark helper error before assessment; that partial record is preserved in [the initial report](evaluations/solo-sequence-coaching-initial.json). The final live report is recorded separately.

The final real provider run passed all eight completion checks: exactly one member, six distinct clips in order, six submitted scripted answers, three scored stages, no other member wait, no active Live lock at the end, no automatic winner and a separate card confirmation. First model audio arrived in 1.07 to 2.17 seconds. Full exchanges took 38.60 to 94.02 seconds including the question, saved participant audio and live reply; these are not GPU inference timings. The API test received audio bytes and transcripts, but did not verify browser rendering or audibility.
