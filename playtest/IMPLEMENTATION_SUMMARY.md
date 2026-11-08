# Current implementation and branch handoff

Latest X23: [saved clips can speak into Gemini Live](RECORDED_LIVE_AND_SECTIONS.md) without microphone access. Only introduction and discussion sections can end early; decisions, private answers and reviewed cards remain mandatory. Current test app: port 8791.

Historical X22 offered whole round bypasses. X23 removes them and retains required decisions and answers.

Earlier X21: [optional Gemini Live private audio](LIVE_AUDIO_WORKFLOW.md) adds explicit microphone conversation in Rounds 2 and 3, native Gemini speech and reviewed transcript drafts. Use port 8789 for the updated local test server. Ordinary speech remains Gemini plus ElevenLabs.

Latest X20: Round 1 now uses [one guided answer box](SINGLE_ANSWER_UPDATE.md), including saved audio drafts and reviewed microphone transcription.


X19 implements all four rounds in the isolated playtest. Branch: **`experiment/ai-voice-playtest`**. This is a feature branch, not a merge into `main` or a public deployment.

The opening preparation agent remains. Round 1 ends with three expert perspectives and individual decisions. Each member then has one private agent for coaching and examination. Round 3 alone awards up to 100 points. Everyone returns for branch comparisons, evidence reviews and a server computed winner.

The optional beta mode fixes the approved question sequence to match 36 current exercise recordings. Twenty seven new ElevenLabs human clips cover individual decisions, coaching, assessment and reunion. Turn matching, completion, draft review and separate submission are enforced. Turning beta mode off before Start enables adaptive Gemini questions; saved answers may need edits. No AI response is prerecorded.

Read [the controls guide](ROUNDTABLE_GUIDE.md), [the complete AI workflow](FOUR_ROUND_WORKFLOW.md) and [the verification report](FOUR_ROUND_REPORT.md). [The confirmed design](FOUR_ROUND_DESIGN.md) remains the product reference. The current test uses T01, exactly three members and independent private branches. The total 15 minute schedule, durable storage, production identity and synchronized audio conferencing are not implemented.

Historical milestones remain in [progress](PROGRESS.md), [Round 1 verification](ROUND_ONE_REPORT.md) and [the earlier voting audio update](VOTING_AUDIO_UPDATE.md). The `legacy` ballot mode and its assets remain available for regression work; new browser rooms use `four_rounds`.
