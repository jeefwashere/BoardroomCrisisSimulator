# Selected AI and speech architecture

Status: selected implementation direction, November 7, 2026. This document governs provider selection, model responsibilities, and the AI integration boundary. [backend-spec.md](backend-spec.md) continues to govern confirmed multiplayer behavior. [TODO.md](../TODO.md) records implementation progress.

## 1. Required architecture

Use Route A: the application backend controls the exercise, local models interpret bounded requests, and ElevenLabs supplies speech input and output. These are eight logical responsibilities sharing state, not eight independent models or autonomous conversations.

1. Use ElevenLabs speech APIs for selected voice features. The current adapter uses `scribe_v2` for short recorded transcription and `eleven_flash_v2_5` for approved text to speech. These are adapter settings, not claims about the provider's newest models or current prices.
2. Use the existing hosted local model API for inference. `lfm3` maps to `LiquidAI/LFM3-1.7B`; `gliner-base` maps to `fastino/gliner2.5-base-v1`.
3. Keep identity, permissions, room state, voting, timers, scenario transitions, and decision records in the application backend. AI returns suggestions and validated data, never authority.
4. Keep typed input and captions usable when speech is disabled. Keep authored outcomes available when optional inference fails.
5. Do not introduce OpenRouter, a hosted commercial LLM fallback, or a managed ElevenAgents orchestrator as a substitute without a new user decision. Existing unrelated keys in a developer environment do not authorize their use.
6. Do not give teammates SSH access or distribute the owner's Velocity credentials. Their backend calls the hosted HTTPS API. Their application users need neither Velocity nor ChatGPT accounts.

The prior [architecture proposal](architecture.md) is retained for context. Its Route B, local speech alternatives, emotional analysis experiments, and proposed gameplay defaults are not selected production features. This document and the confirmed multiplayer specification resolve those ambiguities.

## 2. Boundaries and data flow

```mermaid
flowchart TD
    Browser[Participant application] -->|Typed or reviewed final contribution| Backend[Authenticated application backend]
    Browser -->|Opted in short audio| Backend
    Backend -->|Audio for transcription| Scribe[ElevenLabs speech recognition]
    Scribe -->|Provisional transcript for review| Backend
    Backend -->|Scoped model request and server credentials| Queue[Hosted model API and durable request queue]
    Worker[Private Velocity queue worker] -->|Outbound HTTPS claim and completion| Queue
    Worker -->|Authenticated localhost request| Models[LFM3 on GPU and GLiNER on CPU]
    Backend -->|Validated commands| State[Authoritative room state and decision history]
    Backend -->|Approved text within budget| Speech[ElevenLabs speech generation]
    Speech -->|Audio and captions| Backend
    Backend -->|Current state and scheduled audio| Browser
```

The hosted queue is an inference transport. Its database is not the multiplayer game's room database. The private worker uses outbound HTTPS, so the deployed model service does not depend on the owner's Mac, an exposed compute port, or a teammate's university login.

For the current speech smoke tests, the caller selects a short WAV and receives a provisional transcript. Browser microphone capture, streaming transcription, temporary browser speech tokens, and a live audio playback client still need implementation. Do not claim that the diagram is a fully deployed voice UI.

## 3. Agent roster and current implementation

| Logical role | Responsibility | Selected engine | Current evidence and remaining work |
| --- | --- | --- | --- |
| Preparation agent | Review scenario materials and prepare source references | Authored fixture and code now; shared LFM3 and GLiNER for later drafts | `rehearsal/scenario.py` supplies a fictional fixture. Arbitrary document ingestion and generated scenario approval are not implemented. |
| Facilitator agent | Give short updates and answer scoped questions | LFM3 plus backend validation | `TransformersSelector.select_facts` selects only allowed fact IDs for prototype characters. The controller renders authored facts. The lab's free text generation is separate. |
| Evaluation agent | Explain the recorded outcome using evidence known at the time | Deterministic debrief now; LFM3 drafts only after validation | `Controller.debrief` cites actual records. Full multiplayer feedback and quality validation remain work under B12. |
| Turn coordinator | Assign the floor and maintain the speaking queue | Code | Prototype coordination controls exist. The production sequential speaking and voting flow remains B08 and related tasks. |
| Discussion tracker | Extract names, tasks, deadlines, and contribution types | GLiNER2.5 Base on CPU plus deterministic checks | `GlinerExtractor.extract` returns spans and advisory classes. Rule classifications are retained on disagreement; model output cannot confirm decisions. |
| Timekeeper | Manage deadlines, pause state, and reminders | Code | Prototype ticker and deadline tests exist. Production room and phase deadline handling remains part of B04, B08, and B11. |
| Decision checker | Validate required fields and warn about ambiguity | Code; LFM3 only for future advisory interpretation | Prototype proposal and chair confirmation checks exist. Production custom action outcome mapping is B10 and is not implemented by the generic model endpoint. |
| Discussion climate observer | Suggest clarification, a recap, or inviting input | Code over discussion events | Prototype suggestions exist. No emotion, personality, competence, or psychological scoring is enabled. |

The initial fictional voices are the facilitator, IT support, and journalist. These are scoped personas using the same model and central speech queue. Staff and insurer personas are future content, not additional resident models.

The older Boardroom Mood Listener managed ElevenLabs agent and `ELEVENLABS_AGENT_ID` are not used by Route A. Do not connect the application to that legacy agent accidentally.

## 4. Model inventory

This is an implementation snapshot, not a benchmark or a guarantee that the allocation is still running. Check `GET /api/status` before live tests. Revisions and download checksums are recorded in [the download manifest](../cluster-downloads/download-status.json).

| Repository | Serving status | Intended use |
| --- | --- | --- |
| `LiquidAI/LFM3-1.7B` | Enabled as `lfm3`; GPU | Short dialogue and bounded interpretation |
| `fastino/gliner2.5-base-v1` | Enabled as `gliner-base`; CPU | Entity spans and advisory classification |
| `fastino/gliner2.5-small-v1` | Downloaded only | Smaller extraction candidate |
| `openbmb/MiniCPM5-2B` | Downloaded only | Reasoning comparison |
| `nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16` | Downloaded only | Conversational comparison |
| `ibm-granite/granite-4.2-3b` | Downloaded only | Document and tool use comparison |
| `fastino/GLiNER2.5-Decide` | Downloaded only | Contribution classification candidate |
| `LiquidAI/d1-2B` | Downloaded only | Typed decision queries requiring a dedicated adapter |
| `numind/NuExtract3` | Downloaded only | Document extraction candidate |

One conversational model is resident on the assigned GPU. Do not load the remaining checkpoints concurrently, assume they share an interface, or list them as enabled before integration tests pass. Downloaded weights alone do not demonstrate suitability for custom action evaluation.

## 5. Production gameplay versus the prototype

The confirmed multiplayer specification takes precedence for gameplay: 3 to 20 participants, equal weight votes lasting 60 seconds, CEO selection among tied leaders, and automatic progression after a decision. Do not replace this with the prototype's chair confirmation flow.

The `rehearsal/` package is a working experimental controller with a three participant demo, an authored scenario, explicit chair confirmation, SQLite event history, and a local HTTP API. It is not the planned FastAPI room service, has no production vote implementation, and does not satisfy B01 through B13 by itself. Its 15 minute demo duration is not the production session default. Its fixture does not stand in for team approval of scenario package P02.

Use the prototype's permission checks, evidence snapshots, isolation, and idempotency tests as implementation references. The future backend should validate any generated custom outcome against the captured scenario, room, round, phase, job, and attempt. It alone applies authored metric changes and next nodes. A late model response cannot change an ended game.

All human roles share the released scenario information required by the product specification. Scoped fictional character context and suppression of future unreleased events do not introduce private human player story facts.

## 6. Application integration contract

Read [agent-integration.md](agent-integration.md) for executable examples. The current hosted API provides `GET /api/status`, `POST /api/jobs`, and `GET /api/jobs?id=...`. It does not provide the future room endpoints, an OpenAI compatible chat endpoint, or an ElevenAgents Custom LLM endpoint.

The application's backend owns user authentication, room membership, and the mapping from each user to their model jobs. All requests made with the shared application key have one service identity. Never return its entire request history to an arbitrary application user.

Use an application request ID consistently when retrying submission. Store the queue job ID with the domain operation. Poll approximately every two seconds with a bounded timeout. Timeout is not cancellation: a queued job may finish later and must be ignored if its domain operation is stale.

Current limits are 4,000 prompt characters, 256 generated LFM tokens, 3 pending requests per identity, and 60 submissions per hour. The queue is shared and processes one inference at a time. The prototype client's 120 second wait is not a measured response guarantee. The product proposal of a 15 second AI deadline requires explicit handling of queue delay and late results; it has not been validated for the multiplayer application.

## 7. Speech and cost rules

1. Keep the permanent `ELEVENLABS_API_KEY` on the application backend. Never ship it to the browser or copy the developer's entire `.env.local` to teammates.
2. Submit only opted in audio. Review transcription before committing it under the authenticated participant identity. Partial text and diarization labels do not establish agreement or identity.
3. Speak approved text through one scheduler. Cancel or invalidate obsolete speech when interrupted or when its round ends. Record delivery only after actual playback completes.
4. Speech spending defaults to zero. Paid smoke tests need explicit authorization, a positive cap, and verified account pricing. The local reservation ledger is a conservative estimate, not a provider billing enforcement mechanism.
5. Keep generated speech cached and do not retry paid generations automatically. Speech failures retain readable captions and typed interaction.
6. The existing speech adapter has not passed a paid audio round trip in this project. Do not mark the live voice integration complete on the strength of an API key check or a text demo.

## 8. Availability and ownership

The existing model service uses allocation 20031 and is scheduled to end at **2026-11-08 15:46:25 UTC**, which is **November 8 at 10:46:25 AM Toronto**. The hosted portal and stored results can outlive that allocation; inference cannot. A new allocation requires owner authorization and a checked deployment update.

Normal application agents use only the HTTPS model API. Only an agent explicitly authorized to administer the owner's cluster may use [GPU_ACCESS.d](../GPU_ACCESS.d), after checking the live allocation. That document is an operations reference and grants no account access.

## 9. Evidence and next work

The November 7 implementation run verified 21 Python tests, a three participant controller demo, both hosted model responses, Python and Node clients, rejected invalid credentials, request deduplication, and conflict handling. Browser visual QA was unavailable. These are service and prototype checks, not a full multiplayer or speech acceptance test.

The next integration work belongs to the existing task IDs in [TODO.md](../TODO.md): B10 for validated custom action evaluation, B12 for final feedback, O02 for selected speech capability, and I01 through I04 for frontend contracts and real multiplayer verification. Keep those boxes unchecked until their own criteria pass and their implementation is published.
