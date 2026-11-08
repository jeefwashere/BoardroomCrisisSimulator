# Skip controls for quick tests

X22 adds visible CEO controls directly beneath the meeting clock. Working branch: `experiment/ai-voice-playtest`. Open [the updated local app](http://127.0.0.1:8790/roundtable) and create a fresh room. The earlier servers on ports 8788 and 8789 remain running to preserve existing meetings.

Select Alex, the test CEO. During the opening, choose **CEO: Skip introduction** to start discussion immediately. This stops the opening speech and preserves the normal exercise and winner rules.

The other controls move the whole group:

1. **CEO: Skip Round 1 → private preparation** bypasses the remaining discussion, experts and individual decision gate. Already submitted decisions remain intact. Missing decisions are explicitly marked as not submitted, rather than attributed to a participant.
2. **CEO: Skip remaining preparation → assessment** advances members still coaching or reviewing cards. It keeps their submitted answers and any existing cards, without confirming or inventing a card. Members already assessing are unaffected. The examiner explicitly announces that preparation was skipped.
3. **CEO: Skip remaining assessment → reunion** preserves any submitted assessment answers and earned points. Missing stages receive no synthetic answers or scores. Completed members keep their results; others are labelled incomplete.
4. **CEO: Finish test meeting** ends the reunion without requiring reviews or announcing a winner. Export the written record as usual.

Skipping Round 1, preparation or assessment makes the run a test without a winner ranking. Skipping only the introduction does not disable the normal competition. Ordinary completion and explicit answer review remain unchanged when the skip controls are unused. The controller records every skipped stage, actor and time in the room snapshot and export.

Stop Live microphone audio and wait for pending agent requests before skipping. The controls are disabled while a private model request or reunion summary is pending. A successful skip cancels fixture leases and invalidates earlier question revisions. The selected browser stops ordinary agent speech; other browsers stop stale speech as their phase or question changes. Saved participant clips remain available for the new round and still require manual playback and review.

After an incomplete assessment, the reunion shows an administrative test summary of recorded work. It does not ask an AI model to invent feedback for unanswered questions. The normal Gemini summary remains available for completed assessments. The current Live microphone and Gemini plus ElevenLabs paths remain available in their respective rounds.

## Verification

Passed 164 playtest tests, 50 Node UI checks, 31 existing project tests and the authored demo. New tests cover CEO authority, stale revisions, duplicate requests, pending model locks, every skip transition, retained answers and scores, missing stage review rejection, incomplete reunion rendering and disabled winner ranking. Real HTTP checks are recorded in [the skip integration record](evaluations/skip-rounds.json). No new audio was generated for this change. Browser visual and listening review remain manual.
