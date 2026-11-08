# Access all recordings for your private round

X25 fixes the remaining one clip picker. Open [the updated app](http://127.0.0.1:8793/roundtable) and choose **Load Alex only**. The older server and room remain available on port 8792. This backend update requires a fresh room on port 8793; refreshing an older server does not update its recording API.

## Round 2 controls

**Your recordings for this round** displays all three of Alex's coaching recordings as separate cards. Each shows the full caption, duration and a **Play clip 1**, **Play clip 2** or **Play clip 3** button. The recording intended for the current question is identified. You can preview any of the three before the agent question is ready, replay an earlier clip, or choose another clip after playback finishes. Playback ends at the end of the selected file and does not submit anything.

For a conversation, wait for the agent question and choose **Start Live with saved clips**. Its picker also includes all three of your Round 2 recordings. Select any one and press **Play saved answer into Gemini Live**. You hear the saved audio while Gemini receives it and replies. Stop Live, review the recognized answer and submit separately. The question does not advance merely because a different recording played.

**Run my saved responses** remains the alternative for automatic progression through the three matching recordings and live replies, with explicit approval of their scripted captions. It stops for card confirmation. The manual library and this sequence are distinct controls.

Round 3 similarly exposes all three of your assessment recordings. Other members' recordings and recordings from another private round remain unavailable. Selecting any recording does not award points, confirm a card or skip a question. Native Live sessions retain their two minute connection limit; reconnect when needed, or use the sequence runner's separate connections.

## Implementation

1. `four_round_api.py` lists all owned clips for the current round and serves any selected one. The default internal selection still supports the sequence's current step check.
2. `static/four-round-ui.js` renders the three visible cards, preserves caption selection and permits choosing another clip once playback ends.
3. `live_audio.py` supplies the same complete round list to Gemini Live. Input remains explicitly initiated and scoped to the current member and round.
4. Files remain in `recordings/`; captions and assignments remain in `fixtures/four-round-audio.json`. No audio was regenerated.

Tests serve three distinct real MP3 files before a coach question, reject another member or round, send all three clips through one mocked Live connection without submitting an answer, and verify the three visible UI cards and selection. No new paid provider calls are needed for these access and playback changes. Actual browser listening remains a manual check.

Verification passed: 172 playtest Python tests, 59 Node UI checks, 31 existing prototype tests and the authored demo. All 80 recording hashes are unchanged. Verified 190 unique DOM IDs, documentation links and copied guides. The updated localhost page responds successfully on port 8793.
