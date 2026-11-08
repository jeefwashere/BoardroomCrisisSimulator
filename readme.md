# Boardroom Crisis Simulator

Multiplayer crisis simulation. The FastAPI backend supports frontend supplied room codes, member registration, batch roles on Start, a metric free narrative engine, complete contribution evidence, and gated consequence narration, with capacity 30. The full multiplayer backend is specified and designed. A tested headless rehearsal prototype and a hosted local model API are also available. These do not yet implement the full multiplayer specification. Progress is tracked in [TODO.md](TODO.md).

1. [Backend function guide](docs/backend-guide.md)
2. [Backend specification](docs/backend-spec.md)
3. [Backend architecture](docs/backend-architecture.md)
4. [Shared task list](TODO.md)
5. [Agent collaboration instructions](AGENTS.md)
6. [Agent communication setup](docs/agent-board-setup.md)
7. [Fictional cybersecurity scenario: about 18 minutes](docs/scenarios/cybersecurity-18-minute.md)
8. [Run the FastAPI room API and connect the frontend](docs/room-api.md)
9. [Submit the lobby JSON and enter briefing](docs/start-api.md)
10. [Run the narrative engine and integrate evidence and narration](docs/narrative-engine.md)
11. [Prepare a production Docker Compose deployment with Coolify on Vultr](docs/vultr-coolify-deployment.md)

Agents working on this repository should read `AGENTS.md` and update their own task in `TODO.md` after verifying and pushing completed work.

## Selected speech and local agent architecture

Use ElevenLabs for speech, LFM3 for local conversational inference, GLiNER for extraction, and the application backend for room authority. This direction is recorded in the agent instructions; do not substitute another provider or a managed voice orchestrator silently.

1. [Selected architecture and eight agent roles](docs/ai-architecture.md)
2. [Application agent integration and access boundaries](docs/agent-integration.md)
3. [Prototype commands, speech adapter, and test guide](docs/prototype-guide.md)
4. [Team model playground](https://rehearsal-gpu-lab-team22.arjunb3hl.chatgpt.site)

Teammates use the hosted HTTPS API from their application's backend. They need neither the owner's Velocity account nor SSH access. Application users do not need ChatGPT accounts. The separate team playground requires an invited member login. Ask the owner to provision only the needed server variables; never share the entire `.env.local`.

The enabled model IDs are `lfm3` and `gliner-base`. Seven other model snapshots are downloaded but not enabled. Speech adapters are present, with spending disabled by default; a paid voice round trip and live microphone UI are not yet verified. Recording each participant's own speaking turn and retaining original audio with its attributed transcript during play is now a confirmed requirement for later implementation. The end screen must expose accumulated records for later AI evaluation; the current reviewed text endpoint does not capture or store audio. The current GPU allocation is scheduled to end November 8, 2026 at 10:46:25 AM Toronto. Check the API's status before a live test.

```sh
python3 -m unittest discover -s tests -v
python3 -m rehearsal demo
```

After the required server credentials are configured, a small remote test needs no SSH:

```sh
python3 -m rehearsal.hosted 'Suggest one question for a board chair.'
```
