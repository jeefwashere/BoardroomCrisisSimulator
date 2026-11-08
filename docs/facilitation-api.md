# Facilitation API: AI opening, advisers, expert panel and recorded audio

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

Sources are tried in order and the one used is reported as `source`:

1. `"vertex"`: Vertex AI Gemini (`gemini-3.8-flash`, LOW reasoning, Vertex Express) through `backend/app/vertex_text.py`, when configured. The user approved Vertex Gemini for the main backend agents on Nov 7 2026.
2. `"hosted"`: the existing hosted model (`backend/app/inference.py`, `HostedInference`), when configured.
3. `"offline"`: a deterministic, clearly labelled reply grounded in the public documents, the attached incident report and the current node.

Provider errors never reach the client; a failure silently moves to the next source. Frontend note: `source` is now `"vertex" | "hosted" | "offline"` (plus `null` while pending).

### Vertex configuration

| env var | default | meaning |
| --- | --- | --- |
| `GOOGLE_API_KEY` (or `VERTEX_API_KEY`) | unset | Vertex Express API key. Never logged or returned. |
| `BOARDROOM_VERTEX_ENABLED` | `true` when a key is present, else `false` | Set `false` to force the hosted and offline sources and disable AI ballot options. |
| `BOARDROOM_VERTEX_LEDGER` | `.local/vertex/ledger.sqlite` | Persistent SQLite usage ledger (the playtest `DollarBudget` schema). `.local/` is gitignored. Every attempt, including failures, records a row. |
| `BOARDROOM_VERTEX_UNLIMITED` | `false` | `true` persists the unlimited authorization in the ledger (the user removed app spending caps). Usage rows are still recorded. |
| `BOARDROOM_VERTEX_CAP_CENTS` | `2000` | App reservation cap when not unlimited (five cents reserved per attempt). |

The ledger file is created lazily on the first call, so starting the server or running tests never touches disk. Automated tests inject fakes and force `BOARDROOM_VERTEX_ENABLED=false`.

## Routes

### `GET /api/rooms/{room_id}/facilitation`

```json
{
  "opening": {
    "status": "pending | ready | failed",
    "title": "Opening briefing",
    "text": "AI facilitator introduction of the incident ...",
    "source": "vertex | hosted | offline",
    "speech_id": "uuid or null",
    "error": null
  },
  "expert_panel": null,
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
      "source": "vertex | hosted | offline | null",
      "speech_id": "uuid or null",
      "error": null,
      "at": "ISO timestamp"
    }
  ],
  "documents": [
    {"document_id": "t01_service_outage", "title": "Service outage and unavailable director",
     "pdf_url": "/api/documents/t01_service_outage/pdf"}
  ]
}
```

`opening` is `null` in the lobby. On the first GET after Start the backend generates (once per room) the opening briefing from the scenario title, public documents, the attached incident report and current node. Concurrent callers share the same job. `expert_panel` is described in Expert panel below. `documents` lists the incident reports attached to the room (see Documents).

### `POST /api/rooms/{room_id}/facilitation/consult`

Body `{"command_id": "uuid", "kind": "facilitator|it|journalist", "question": "1..1000 chars"}`. Any current room member may ask while the game is started and not ended. One pending consultation per member; exact retry of the same `command_id` returns the original. Returns the consultation object (status `pending`, completes asynchronously; poll the GET). Consultations are visible to every member of the room (shared advisers tab).

### `POST /api/rooms/{room_id}/facilitation/speech/{speech_id}/prepare` and `GET .../speech/{speech_id}/audio`

Optional speech for the opening, a consultation reply or an expert panel take, through the existing budgeted `NarrationService` (voice is disabled by default and requires the configured budget). `prepare` returns `{"status": "ready|disabled|failed|pending", "error": null}`; `audio` returns `audio/mpeg`. Text always remains readable.

## Expert panel

An optional stage between the speaking turns and voting. After the last speaker's turn, the three AI experts (facilitator, IT adviser, journalist) each give a short live take on the round's discussion, then voting opens.

### Timing

A scenario timing profile enables it with `"unused_speaking_seconds": "expert_panel"` (the other values `"open_discussion"` and `"skip_to_vote"` are unchanged). When the last turn ends, the room enters the existing `discussion` phase with `phase_deadline` exactly 90 seconds later (never beyond `session_deadline`). When the deadline passes, the ballot freezes and voting opens as usual. The host can end the stage early with the existing `skip_phase` command (`POST /api/rooms/{room_id}/rounds/{round_id}/skip-phase`), which opens voting at once. Both Cedar Bridge T01 profiles (`standard_18`, `fast_15`) use `"expert_panel"`; the other scenarios keep `"open_discussion"`. Proposals and answers stay allowed during the stage, exactly as in any `discussion` phase.

The room snapshot has a new field `game.discussion_mode`: `"experts"` when the room's timing profile uses the expert panel, otherwise `"open"`. It is fixed for the whole game, so the UI can read it during speaking as well; render the expert stage when `phase == "discussion"` and `discussion_mode == "experts"`.

### Shape

`GET /api/rooms/{room_id}/facilitation` returns `expert_panel`:

```json
{
  "expert_panel": {
    "round_id": "uuid",
    "status": "pending | ready",
    "experts": [
      {"kind": "facilitator", "label": "Facilitator", "status": "pending | ready | failed", "text": "spoken take",
       "source": "vertex | hosted | offline | null", "speech_id": "uuid or null", "error": null},
      {"kind": "it", "label": "IT adviser", "status": "...", "text": "...", "source": "...", "speech_id": "...", "error": null},
      {"kind": "journalist", "label": "Journalist", "status": "...", "text": "...", "source": "...", "speech_id": "...", "error": null}
    ]
  }
}
```

`expert_panel` is `null` until a panel exists. The experts always appear in the fixed order facilitator, it, journalist. The panel `status` is `"ready"` once all three experts are terminal (`ready` or `failed`). `text` is an empty string while pending. A `failed` expert has `error: "Expert take unavailable"`; in practice each expert falls back to offline text instead of failing.

### Generation

The first GET while the room is in `discussion` with `discussion_mode == "experts"` starts one shared job for that round; concurrent callers share it and no second job is ever started for the same round. The three experts are generated in parallel through the same Vertex, hosted, offline chain as the other facilitation text, and each falls back to its own offline take on its own. Poll the GET until `status` is `"ready"`.

Each take is about 60 to 90 words of speakable prose (markdown and list markers are stripped), in that expert's persona, grounded only in the current node title, situation and study questions, the public documents, the attached incident report, and this round's contributions so far (answers and chat, attributed by display name and role name; committed saved clip captions are answer contributions, so they are included). The hidden controller reference is never read. Experts are advisory only: they cannot vote, pick a winner, or claim facts beyond the sources. The facilitator summarizes trade offs and gaps, the IT adviser names what must be verified, and the journalist says what can be said publicly.

Each ready expert has a `speech_id` that works with the existing `POST .../facilitation/speech/{speech_id}/prepare` and `GET .../facilitation/speech/{speech_id}/audio` routes.

The latest panel stays in the response after its stage ends (during voting, result and after the game ends) so the UI can show it later. Compare `expert_panel.round_id` with `game.round_id` to tell whether it belongs to the current round.

### `GET /api/recordings` and `GET /api/recordings/{clip_id}/audio`

Public, read only catalog of the prerecorded fictional ElevenLabs MP3 fixtures in `playtest/recordings/` (no provider call, no auth). Catalog entry:

```json
{"clip_id": "t01_decision_prompt", "group": "decision_guide | participant | facilitator | adviser | journalist | discussion | control | reference",
 "label": "Recorded decision guide", "speaker": "Facilitator", "text": "caption", "duration_seconds": 19.74,
 "audio_url": "/api/recordings/t01_decision_prompt/audio"}
```

Playback never creates a contribution, ballot, or turn change. The UI labels these as recorded.

## Documents

### `GET /api/documents` and `GET /api/documents/{document_id}/pdf`

Public, read only catalog of the three hardcoded demo incident report PDFs in `output/pdf/` (built by `playtest/build_pdf_memory.py` from the public participant packs; no auth, no provider call). Catalog entry:

```json
{"document_id": "t01_service_outage", "title": "Service outage and unavailable director",
 "filename": "demo-t01-service-outage.pdf", "pack": "T01", "default": true,
 "summary": "one or two sentence public summary", "pdf_url": "/api/documents/t01_service_outage/pdf"}
```

The other entries are `t02_fundraising` (T02) and `t03_succession_payroll` (T03), both `"default": false`. The PDF route returns `application/pdf` with `Content-Disposition: inline; filename="..."`. IDs are checked against the fixed catalog; anything else returns 404 `document_not_found`.

The default document (T01) is attached to every room. Its public pack text from `playtest/fixtures/participant-packs.json` (T01 document IDs, titles and text only) is added to the opening briefing and adviser prompts as a labelled "Attached incident report" source within the existing prompt size limit, and the offline replies quote its most relevant section. The controller reference is never read or indexed.

## AI ballot options

Each round, agents draft the voting options instead of the authored prepared options. Humans still vote; models cannot vote, pass turns, or change results.

### Room setting

`POST /api/rooms/{room_id}/start` accepts an optional `"ballot_source": "ai" | "authored"` (default `"ai"`). With `"authored"` no generation runs and the node's prepared options are used. The value is stored on the game and returned as `game.ballot_source`.

### Generation

When the round's speaking phase begins, the server starts one Vertex job, and it refreshes once when discussion begins (the latest ready set wins; an older job cannot replace a newer ready set). The prompt contains only public or allowed information: the current node title, situation and study questions, public facts and documents, the attached incident report text, this round's contributions, and the node's allowed custom outcome IDs (as aliases O1, O2, ...) with their authored summaries. The hidden controller reference is never read.

Output must be exactly three options with distinct labels (8 to 160 characters), a description of 20 to 400 characters, a rationale of 5 to 300 characters, and an outcome that is one of the node's `allowed_custom_outcome_ids`. Invalid output or a provider failure is retried once; after that the round falls back to the prepared options. Results are stored on the game through the room owner with job IDs, and a result for an older round, an unknown job, or an already frozen ballot is discarded.

When discussion ends and voting opens, the ballot freezes: ready AI options plus any human custom proposals, otherwise the prepared options plus custom proposals.

### Snapshot fields (`game`)

| field | values | meaning |
| --- | --- | --- |
| `ballot_source` | `"ai" \| "authored"` | Room setting from Start. |
| `options_source` | `"ai" \| "prepared_fallback" \| "authored"` | Where `current_node.options` come from. Before voting it describes the ballot that would freeze now; after freezing it is fixed for the round. `"prepared_fallback"` means agents were not ready, failed, or are not configured. |
| `ai_options_status` | `"pending" \| "ready" \| "failed" \| "disabled"` | `pending`: agents are drafting (show "Agents are drafting options"). `ready`: AI options are in use. `failed`: the round uses the prepared fallback. `disabled`: Vertex not configured, `ballot_source` is `"authored"`, or the node allows no custom outcomes. |

AI options appear in the existing `current_node.options` list (during speaking and discussion as a preview, and frozen during voting and tie break):

```json
{"option_id": "ai_3f2c9d0e1a2b4c5d", "label": "Isolate the finance systems and appoint an incident lead",
 "kind": "ai", "member_id": null,
 "description": "One or two sentences explaining the action.",
 "rationale": "One short sentence on why the expected consequence follows."}
```

Prepared options keep `kind: "prepared"` and custom proposals keep `kind: "custom"` with `member_id`; both have `description` and `rationale` set to `null`. The validated `outcome_id` is kept on the server and never sent to players.

### Resolution

When an AI option wins (vote or CEO tie decision), it resolves immediately to its prevalidated authored outcome with no resolving phase. The decision record has `resolution_kind: "ai"`, `selection_method` (`"vote"` or `"ceo"`), `vote_counts`, the option label as `selected_option_label`, and `ai_job_id` set to the job that drafted the ballot. Human custom proposals keep the existing 15 second custom resolution path, now tried first with Vertex when configured (strict `{"outcome": alias}` validation against the node's `allowed_custom_outcome_ids`), then the hosted resolver. Members can also add a custom option while voting is open; see the custom actions section of [gameplay API](gameplay-api.md).
