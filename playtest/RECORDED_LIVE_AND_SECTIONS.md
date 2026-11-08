# Saved recordings in Live and protected decisions

X23 corrects the earlier broad skip controls and lets saved participant audio act as input to Gemini Live. Working branch: `experiment/ai-voice-playtest`. Open [the updated app](http://127.0.0.1:8791/roundtable) and create a fresh room. Earlier meetings remain on their original localhost ports.

## What you can skip

1. The CEO can skip the opening introduction and begin discussion.
2. The CEO can finish discussion early and hear the three expert perspectives.
3. After all three expert responses complete, the CEO can continue to individual decisions.
4. During private rounds, use Stop agent speech or Stop Live session to stop audio. The current answer remains required.

Whole round bypasses are removed from the UI and rejected by the backend. Every member must submit their individual decision, answer the coaching questions, review and confirm their response card, and submit all three assessment answers. Reunion review and winner gates still apply. These section controls preserve normal scoring and do not create placeholder decisions, cards or scores. Existing records from the earlier broad skip test remain readable as historical incomplete tests.

## Where the recordings are

Round 1 discussion clips are beneath the current participant's controls. Play the clip, then explicitly commit its caption and pass the turn.

Round 1 decisions, private coaching, private assessment and reunion reflections appear under **Saved answer for this turn**. The current member and question determine the clip. This original route plays the recording locally, then loads its trusted caption as an editable draft. It still works.

The files are in `playtest/recordings/`. The 36 active exercise clip assignments and captions are in `playtest/fixtures/four-round-audio.json`, with file integrity and durations in `playtest/recordings/manifest.json`. This update reuses the existing ElevenLabs recordings and generates no new prerecorded audio.

## Use a saved clip to talk to the Live agent

For Round 2 or 3:

1. Select Alex, Morgan or Sam. Wait for that member's current question. Stop ordinary speech or a saved preview if it is still playing.
2. Choose **Start Live with saved clips** in the Live conversation panel. This does not request microphone permission or capture microphone audio.
3. The panel loads the recording for that member and question. Its caption is shown for inspection.
4. Choose **Play saved answer into Gemini Live**. You hear the saved voice while the same audio streams into Gemini at real time speed. The server validates the member and question before choosing the file.
5. Gemini transcribes the actual audio and speaks its reply. This is a live model response, not a saved AI reply. If the model replies before the recording ends, the browser holds that speech until participant playback finishes. An interruption clears superseded model audio.
6. Click **Stop Live session**, then **Use recognized words as an answer draft**. Correct recognition mistakes and remove conversational questions. Confirm and submit the answer separately.
7. The next question becomes available through the ordinary workflow. Start another saved clip Live connection for that question if desired.

You do not need to talk live. **Start Live with microphone** remains a separate option. A connection uses one input mode; saved clip mode rejects raw microphone frames and cannot fetch another member's recording. Stop cancels ongoing clip transmission and playback. No playback, transcription or model reply can submit an answer or score it automatically.

Saved recordings use their existing ElevenLabs participant voices. Gemini Live answers in native Gemini speech. Ordinary agent speech still uses Gemini text plus ElevenLabs. The saved clip decoder uses the already installed local `ffmpeg`; no software or model download was performed. Real Live calls use the existing usage ledger and unlimited authorization. Cached MP3 reuse does not regenerate ElevenLabs speech.

Written exports identify the Live input mode and clip IDs. A reviewed answer derived from a recorded Live session is marked as scripted after the backend verifies that the session belongs to this member and question. Other members' private material remains hidden.

## Verification

Passed 167 playtest tests, 51 Node UI checks, 31 existing project tests and the authored demo. Controlled tests cover rejection of whole round skips, required decisions and reviews, origin and membership checks, wrong clip rejection, microphone rejection in saved mode, paced clip cancellation, explicit answer submission and provenance. Browser handler tests verify no microphone request in saved mode, actual clip control messages, local participant audio and deferred model audio playback.

[The real Live integration](evaluations/live-recorded-clips.json) used Alex's Round 2 and Round 3 recordings through the new server command, with actual retrieval and model responses. Both normalized transcripts matched their source scripts exactly. The app streamed 17.18 seconds of saved input in Round 2 and 20.25 seconds in Round 3. It received 31.48 and 18.55 seconds of nonzero model audio, respectively, including the opening question. First output PCM arrived in approximately 1.48 and 2.13 seconds from connection start. Answers remained unsubmitted and locks were released on Stop. These two samples do not establish broad recognition quality or identical future responses.

Human microphone permission, real speaker sound and browser visual quality remain manual checks. No computer control or human listening was used to claim these results.

To repeat the paid check explicitly:

```sh
.venv/bin/python -m playtest.live_audio_benchmark --live --saved-clips --url http://127.0.0.1:8791
```
