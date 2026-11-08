# Complete gameplay integration

The feature branch implements prepared and custom gameplay, participant turn recordings, real ElevenLabs transcription and narration, and evidence linked final qualitative AI assessment. The user removed the custom proposal character cap and authorized USD 100 in speech tests. The current harness window is November 8 at 00:37:02 UTC through 01:07:02 UTC. Publication, merge and shared activation remain separate states.

## Custom actions and authority

Each eligible member may maintain one editable proposal during speaking or shared discussion. Empty text withdraws the current proposal. Every submitted revision remains an attributed contribution. Voting freezes both prepared and custom choices. There is no product character limit; malformed Unicode is rejected before mutation. The obsolete 1000 character metadata in the pinned historical scenario does not apply to this runtime policy.

Only a winning custom action is sent to the existing hosted LFM service. The backend retains its exact text, SHA256, proposer, round, node, pinned scenario checksum, job and attempt. Large text is partitioned without dropping characters. The complete operation has one 15 second deadline, including fragment work. If all fragments cannot finish in that time, the action visibly fails and remains retained; it is never silently shortened or converted to a prepared action. The host may explicitly retry once. Failed resolution otherwise waits for a host ending or total expiry.

Provider output may select only an authored allowed outcome. Code validates job, attempt, round, phase, scenario, node and proposal hash before applying it. Late and duplicate callbacks cannot alter newer or ended games. The authored consequence remains the source of narrative state and facts.

## Frontend and recording

The UI retains Jeff's presentation and animation work. It displays authoritative phases, countdowns, speakers, early finish, host skip, hidden replaceable ballots, CEO tie selection, reassignment, custom resolution progress, captions and final history. Transport uncertainty retains command intent IDs; definitive rejected commands clear the rejected intent after snapshot recovery.

Recording requires explicit participant opt in and browser permission. Only the active authenticated speaker receives a recoverable grant. Phase, deadline, lost authority and leaving stop capture and tracks. The client records a supported MediaRecorder container, retains failed upload bytes for explicit retry, and uses private authenticated playback.

Original bytes are immutable, limited to 10 MB, and stored in `BOARDROOM_RECORDINGS_DIR` with directory mode 700 and file mode 600. Metadata retains room, authenticated member, round, phase, timestamps and SHA256. `ffmpeg` validates actual decoded duration against elapsed upload time, grant and authoritative earlier turn endings before any paid transcription. Upload grace is 60 seconds. Originals which exceed authority remain failed evidence without a provider call. The original owner may review the transcript once. Pending media remains visible and blocks premature AI assessment; gameplay decisions remain frozen.

Files persist, but room state is still in memory and does not recover across server restart. Shutdown cancels and awaits processing, retaining interrupted recording metadata.

## Final AI assessment

The final factual history remains available without AI. All decisions, custom revisions, answers, chats, reviewed speech and unresolved selected actions enter assessment with their actual member, round, scenario rubric and facts known at submission. Result chats see released consequence facts; lobby chats see initial facts. Missing speech is explicit rather than invented.

Text is partitioned exactly into bounded provider batches. Each row receives one validated rubric classification, `supported` or `clarify`. The backend renders strengths, risks and suggested improvements with exact expandable assessed excerpts. This is qualitative exercise feedback, without numerical scores, psychological traits or new narrative facts. It is not a validated educational measurement instrument.

Provider failures preserve factual history and expose progress. Earlier truncated JSON and unsupported model claims are preserved as counterexamples in `docs/evidence`. The accepted protocol completed all eight batches in the real browser game. Later deterministic fixes to full excerpt references, historical context and invalid Unicode have independent regression coverage; the earlier raw browser artifact retains its original shorter quotation format.

## Backend configuration and spending

Use the existing hosted model URL and token on the backend. No new GPU worker or alternate hosted model was introduced. TLS uses operating system roots through truststore with certificate verification enabled.

```text
BOARDROOM_STT_ENABLED=true
BOARDROOM_TTS_ENABLED=true
BOARDROOM_VOICE_BUDGET_USD=100
BOARDROOM_STT_USD_PER_MINUTE=<verified conservative rate>
BOARDROOM_TTS_USD_PER_1K=<verified rate>
BOARDROOM_TTS_LEDGER=<shared private SQLite ledger>
BOARDROOM_RECORDINGS_DIR=<private storage directory>
ELEVENLABS_API_KEY=<backend secret>
BOARDROOM_TTS_VOICE_ID=<authorized voice>
```

Voice defaults off. Price, key, cap and usable ledger are required. Reservations are atomic and shared by TTS and STT, including failures. Short STT reserves a full minute conservatively. Paid failures are not automatically retried. No browser provider token, account setting change or automatic top up is used. A local estimate does not enforce the provider's account billing.

Actual tests used `eleven_flash_v2_5`, George and `scribe_v2`. Ten STT and two TTS reservations total approximately USD 0.07651 against the USD 100 local cap. This is an estimated reservation, not a billed dollar receipt. Provider credit readback changed from 662 to 736, and account overage extension remained disabled. Per request actual USD was unavailable. See [budget evidence](evidence/voice-budget-audit-20261108.json) and [direct round trip](evidence/voice-paid-roundtrip-20261108.json).

Official references: [ElevenLabs transcription](https://elevenlabs.io/docs/api-reference/speech-to-text/convert), [public pricing](https://elevenlabs.io/pricing/api?price.section=speech_to_text), [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).

## Verification

Final checks passed 138 backend tests, 86 frontend tests after current main room chat integration, 31 prototype and board tests, seven narration player tests, frontend build and lint, and the authored offline demo. The main room chat stays mounted beside the game across phases; the hook retains both refresh and gameplay execute. The final merge received the affected frontend checks; the full browser game preceded that room chat merge.

## Actual acceptance evidence

Three independent browser tabs completed join, roles, three speaking and voting rounds, a CEO tie selecting a custom winner, actual hosted LFM allowed outcome mapping, final history and eight successful final AI batches. All three participants across all three rounds produced nine browser MediaRecorder originals, actual ElevenLabs transcriptions and owner reviews. A real TTS consequence produced browser started and completed playback events. Final page reload preserved the same seat, three members and unchanged history. The complete final screen was visually inspected.

The browser audio source was an explicitly synthetic spoken fixture routed through a real MediaStream. This validates capture, transport, decoding and real providers; it does not establish physical microphone hardware quality. The authored schedule used a controlled server clock rather than an eighteen minute human play session. Mid vote seat and ballot recovery have separate HTTP regression coverage.

Evidence: [complete browser result](evidence/browser-live-game-voice-20261108.json), [final reload](evidence/browser-rejoin-final-20261108.json). All three exact owned pages were closed and absence checked, the exact lease released with managed browser stopped, and both disposable QA services stopped. Existing user services were untouched.

Game WebSockets, durable room recovery, cloud deployment, arbitrary document driven scenario generation, optional scenario documents and physical microphone acceptance remain outside this delivered software verification. Document upload still acknowledges rather than processes contents. See I04 and O01 for remaining project work.
