# Facilitation API: AI opening, advisers and recorded audio

This contract brings the `experiment/ai-voice-playtest` meeting features into the main FastAPI backend (`backend/app`) and the main website (`my-app`). The authoritative game (phases, speakers, ballots, CEO tie, results) stays in `backend/app/rooms.py`; nothing here can vote, pass a turn, or change a result.

All room routes use the existing tab session authentication (`X-Boardroom-Session` header or cookie) and require the caller to be a member of the room. Errors use the existing `{"detail": {"code", "message"}}` shape.

## Advisers

Fixed catalog, ported from the playtest:

| kind | label | role |
| --- | --- | --- |
| `facilitator` | Facilitator | Neutral meeting coach: clarifies assumptions, summarizes trade offs, prompts quiet members. |
| `it` | IT adviser | Technical recovery character: dependencies, backups, what must be verified before promising restoration. |
| `journalist` | Journalist | Outside pressure: what can be said publicly, separating confirmed facts from unknowns. |

## Text generation

Uses the existing hosted model (`backend/app/inference.py`, `HostedInference`) when configured. When it is not configured or fails, a deterministic, clearly labelled offline reply grounded in the public documents and current node is returned with `"source": "offline"`. Gemini/Vertex from the playtest is not wired into the main backend (AGENTS.md: no provider substitution without an explicit decision).

## Routes

### `GET /api/rooms/{room_id}/facilitation`

```json
{
  "opening": {
    "status": "pending | ready | failed",
    "title": "Opening briefing",
    "text": "AI facilitator introduction of the incident ...",
    "source": "hosted | offline",
    "speech_id": "uuid or null",
    "error": null
  },
  "advisers": [{"kind": "facilitator", "label": "Facilitator", "description": "..."}],
  "consultations": [
    {
      "consultation_id": "uuid",
      "kind": "it",
      "member_id": "uuid",
      "round_number": 1,
      "phase": "discussion",
      "question": "What must be verified before we promise a restoration time?",
      "status": "pending | ready | failed",
      "reply": "text or null",
      "source": "hosted | offline | null",
      "speech_id": "uuid or null",
      "error": null,
      "at": "ISO timestamp"
    }
  ]
}
```

`opening` is `null` in the lobby. On the first GET after Start the backend generates (once per room) the opening briefing from the scenario title, public documents and current node. Concurrent callers share the same job.

### `POST /api/rooms/{room_id}/facilitation/consult`

Body `{"command_id": "uuid", "kind": "facilitator|it|journalist", "question": "1..1000 chars"}`. Any current room member may ask while the game is started and not ended. One pending consultation per member; exact retry of the same `command_id` returns the original. Returns the consultation object (status `pending`, completes asynchronously; poll the GET). Consultations are visible to every member of the room (shared advisers tab).

### `POST /api/rooms/{room_id}/facilitation/speech/{speech_id}/prepare` and `GET .../speech/{speech_id}/audio`

Optional speech for the opening or a consultation reply, through the existing budgeted `NarrationService` (voice is disabled by default and requires the configured budget). `prepare` returns `{"status": "ready|disabled|failed|pending", "error": null}`; `audio` returns `audio/mpeg`. Text always remains readable.

### `GET /api/recordings` and `GET /api/recordings/{clip_id}/audio`

Public, read only catalog of the prerecorded fictional ElevenLabs MP3 fixtures in `playtest/recordings/` (no provider call, no auth). Catalog entry:

```json
{"clip_id": "t01_decision_prompt", "group": "decision_guide | participant | facilitator | adviser | journalist | discussion | control | reference",
 "label": "Recorded decision guide", "speaker": "Facilitator", "text": "caption", "duration_seconds": 19.74,
 "audio_url": "/api/recordings/t01_decision_prompt/audio"}
```

Playback never creates a contribution, ballot, or turn change. The UI labels these as recorded.
