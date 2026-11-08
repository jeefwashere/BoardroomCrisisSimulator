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

## Voices and AI replies

Every speaker has its own premade ElevenLabs voice (`backend/app/voices.py`, chosen through the ElevenLabs MCP): the facilitator (George), the IT and security expert and IT adviser (River), operations (Matilda), governance (Alice), the journalist (Laura) and the private coach (Sarah). Players' AI replies speak in their role's voice: CEO (Roger), IT recovery lead (Will) and communications lead (Bella). `BOARDROOM_TTS_VOICES` (a JSON object of key to voice ID) overrides any entry; missing keys use `BOARDROOM_TTS_VOICE_ID`. The voice is chosen on the server when a line is prepared, so clients never pick voices.

`POST /api/rooms/{room_id}/facilitation/reply` with `{command_id, mode, question?}` drafts a reply the caller can use as their own:

* `mode: "turn"`: only during the caller's own speaking turn (409 `not_your_turn` otherwise). Vertex writes a first person reply of 50 to 80 words for the caller's role, grounded in the scenario, documents, attached report and this round's contributions. Any room member can play its speech, so the three window demo shares it with every window.
* `mode: "private"`: only in the private session; `question` is the coach's current question. The answer builds on the caller's own written decision. Its speech is readable only by the caller.

The response is `{reply_id, speech_id, mode, text, source}`; `source` is `vertex` (or `hosted` if Vertex failed). There is no offline fallback: 503 `ai_reply_unavailable` asks the player to retry or type. Play it with the speech `prepare` and `audio` routes below. A reply is only a draft: the player's client commits it as a contribution (speaking turns) or submits it as the private answer, and the model never submits anything itself.

Speed: spoken text (agent lines, AI replies and coach questions) is generated with Gemini thinking off (`thinkingBudget: 0`); on this model the LOW thinking level spent 500+ tokens and 8 to 17 seconds on a 60 word line, against about 3 seconds without. Scoring and other JSON calls keep their thinking level. AI replies are grounded with Google embeddings (`gemini-embedding-001`, 768 dimensions, `backend/app/grounding.py`): public documents and attached report sections are split into passages of about 480 characters, embedded once per process, and the passages closest to the speaker's role and the latest contributions (or the coach's question) fill the prompt's 2 KB document budget; any failure falls back to the plain documents. Embedding calls are not written to the Vertex spending ledger.

`GET /api/rooms/{room_id}/facilitation/speech/{speech_id}/stream` returns a line's MP3 as ElevenLabs produces it (64 kbps, first audio in about a quarter second). The first request starts one upstream synthesis; every other window reads the same chunks, and once complete the line is cached for `prepare` and `audio` like any other. Access rules match `audio`. The app plays it through Media Source Extensions and falls back to the whole file where those are unavailable. Measured end to end in Chrome: about 2.9 seconds from pressing AI reply to hearing it, down from 8 to 11 seconds.

In the private session the Round 2 coach's questions are now phrased by Vertex (temperature 0.3, at most 60 words) from the approved canonical question, the member's decision and previous answer; the canonical question stays the graded question and is used whenever Vertex is off or returns no question. Answers open once the phrased question is ready.

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

An optional stage between the speaking turns and the round's decision. After the last speaker's turn, three AI experts (IT and security, operations and community services, governance and finance) each give a short live take on what the board actually said, then the decision opens: voting, or the individual decision phase when the timing profile uses `"decision_mode": "individual"` (see [gameplay API](gameplay-api.md)). The expert panel kinds are separate from the consultation advisers (facilitator, IT adviser, journalist), which are unchanged.

### Timing

A scenario timing profile enables it with `"unused_speaking_seconds": "expert_panel"` (the other values `"open_discussion"` and `"skip_to_vote"` are unchanged). When the last turn ends, the room enters the existing `discussion` phase with `phase_deadline` exactly 90 seconds later (never beyond `session_deadline`). When the deadline passes, the ballot freezes and voting opens as usual, or in individual decision mode the `individual_decision` phase begins. The host can end the stage early with the existing `skip_phase` command (`POST /api/rooms/{room_id}/rounds/{round_id}/skip-phase`), which opens the next phase at once. Both Cedar Bridge T01 profiles (`standard_18`, `fast_15`) use `"expert_panel"` and `"decision_mode": "individual"`; the other scenarios keep `"open_discussion"` and voting. Proposals and answers stay allowed during the stage, exactly as in any `discussion` phase.

The room snapshot has a new field `game.discussion_mode`: `"experts"` when the room's timing profile uses the expert panel, otherwise `"open"`. It is fixed for the whole game, so the UI can read it during speaking as well; render the expert stage when `phase == "discussion"` and `discussion_mode == "experts"`.

### Shape

`GET /api/rooms/{room_id}/facilitation` returns `expert_panel`:

```json
{
  "expert_panel": {
    "round_id": "uuid",
    "status": "pending | ready",
    "experts": [
      {"kind": "security", "label": "IT and security", "status": "pending | ready | failed", "text": "spoken take",
       "source": "vertex | hosted | offline | null", "speech_id": "uuid or null", "error": null},
      {"kind": "operations", "label": "Operations and community services", "status": "...", "text": "...", "source": "...", "speech_id": "...", "error": null},
      {"kind": "governance", "label": "Governance and finance", "status": "...", "text": "...", "source": "...", "speech_id": "...", "error": null}
    ]
  }
}
```

`expert_panel` is `null` until a panel exists. The experts always appear in the fixed order `security`, `operations`, `governance`. The panel `status` is `"ready"` once all three experts are terminal (`ready` or `failed`). `text` is an empty string while pending. A `failed` expert has `error: "Expert take unavailable"`; in practice each expert falls back to offline text instead of failing.

### Generation

The first GET while the room is in `discussion` with `discussion_mode == "experts"` starts one shared job for that round; concurrent callers share it and no second job is ever started for the same round. The three experts are generated in parallel through the same Vertex, hosted, offline chain as the other facilitation text, and each falls back to its own offline take on its own. Poll the GET until `status` is `"ready"`.

Each take is about 60 to 90 words of speakable prose (markdown and list markers are stripped), in that expert's persona, grounded only in the current node title, situation and study questions, the public documents, the attached incident report, and this round's contributions so far (answers and chat, attributed by display name and role name; committed saved clip captions are answer contributions, so they are included). The hidden controller reference is never read. Experts are advisory only: they cannot vote, pick a winner, or claim facts beyond the sources. Each responds to the board's actual contributions. The IT and security expert says what is technically known, what is uncertain and which proposed steps are risky; the operations and community services expert says how staff and community members will be affected; the governance and finance expert says who can authorize the proposed actions and which resources and responsibilities matter. Each kind has its own clearly labelled offline take (for example "Offline IT and security take (no AI model connected).") that quotes the recorded contributions.

Each ready expert has a `speech_id` that works with the existing `POST .../facilitation/speech/{speech_id}/prepare` and `GET .../facilitation/speech/{speech_id}/audio` routes.

The latest panel stays in the response after its stage ends (during voting, result and after the game ends) so the UI can show it later. Compare `expert_panel.round_id` with `game.round_id` to tell whether it belongs to the current round.

### `GET /api/recordings` and `GET /api/recordings/{clip_id}/audio`

Public, read only catalog of the prerecorded fictional ElevenLabs MP3 fixtures in `playtest/recordings/` (no provider call, no auth). Catalog entry:

```json
{"clip_id": "t01_decision_prompt", "group": "decision_guide | participant | facilitator | adviser | journalist | discussion | control | reference | private_coaching | private_assessment",
 "label": "Recorded decision guide", "speaker": "Facilitator", "text": "caption", "duration_seconds": 19.74,
 "audio_url": "/api/recordings/t01_decision_prompt/audio"}
```

Playback never creates a contribution, ballot, or turn change. The UI labels these as recorded. The 18 saved fictional member answers for the private rounds (`r2_member_{seat}_step_{step}` in group `private_coaching` and `r3_member_{seat}_step_{step}` in group `private_assessment`, seats 1 to 3) are part of this catalog; the private session payload points at the one matching the caller's current question.

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

## Rounds 2 and 3: private coach and examiner

After the Round 1 individual decisions, Cedar Bridge rooms enter the `private_session` phase (see [the gameplay API](gameplay-api.md#rounds-2-and-3-private-session-phase)). Each electorate member works through a private branch with one agent, labelled "Crisis coach". The same agent coaches in Round 2 and becomes the examiner in Round 3. Branches run concurrently and independently: one member's answers never change another member's branch. The implementation is `backend/app/private_sessions.py`, ported from the playtest four round beta.

Beta mode is always on for Round 2. The approved twists and the canonical coaching questions follow the order of the saved fixture answers. Gemini writes the short acknowledgements and the response card draft at temperature 0, and the five Round 3 multiple choice questions at temperature 0.4. The server validates the questions, shuffles the choices, records each pick and computes every total.

### Flow

1. Round 2 coaching, no points. The first GET during the phase creates the branch and presents the twist "The IT specialist is now unavailable. Your original response relied on their advice." and question 1. After each answer the coach acknowledges it in one short sentence and asks the next canonical question. Question 2 follows the approved update "The alternate provider can investigate, but needs an authorized contact." After the third answer the coach drafts a seven field response card (action, responsibility, evidence, dependencies, fallback, communication, review). The member edits every field and confirms it.
2. Round 3 assessment, up to 100 points. After the card is recorded the examiner posts the transition "Your preparation is complete. The scored challenge begins now. I will ask you five multiple choice questions about your response." and Gemini writes five questions for this member (`quiz.status: "generating"`, `busy: true`). Each question is posted as a ready agent `question` message (round 3, step 1 to 5) when it becomes current, so it is spoken and captioned like other coach lines; its four choices are shown as buttons and are not spoken. The member picks one choice per question with `POST .../private-session/choice`; picks are final. The server reveals that question's points, posts "Question n: X of 20 points." and then the next question. After question 5 the stage becomes `complete` and the full review (every choice's points and rationale) is released.
3. Complete. The phase ends for the whole room when every electorate member is complete, at the deadline, or on a host `skip_phase`.

| Round | Step | Development message | Question |
| --- | --- | --- | --- |
| 2 | 1 | twist: The IT specialist is now unavailable. Your original response relied on their advice. | What would you do next? |
| 2 | 2 | update: The alternate provider can investigate, but needs an authorized contact. | What authority, access and dependencies must you establish before they can investigate? |
| 2 | 3 | none | Review your proposed response: who should act, what is the fallback, who needs an update, and when would you review progress? |
| 3 | 1 to 5 | transition (after the card) | Five Gemini multiple choice questions for this member; a later question may introduce the approved update "The alternate provider cannot begin immediately. Staff still need instructions." inside its own text. |

### `GET /api/rooms/{room_id}/private-session`

Returns the caller's own branch only. It works during `private_session` and after the game ends. Before the phase (or in a room without private rounds) it returns 409 `not_private_session`; a member outside the round electorate gets 403 `not_eligible`; after the phase ends, a member who never opened a branch gets 404 `private_session_not_started`. Concurrent first reads create exactly one branch.

```json
{
  "round": 2,
  "stage": "coaching | card | assessment | complete",
  "agent": {"label": "Crisis coach", "role": "coach | examiner"},
  "decision_text": "the caller's own Round 1 decision, or null",
  "messages": [
    {"message_id": "uuid", "author": "agent | member",
     "kind": "twist | question | ack | update | transition | answer | result",
     "round": 2, "step": 1, "text": "...", "status": "pending | ready | failed",
     "source": "vertex | hosted | offline | canonical | null", "speech_id": "uuid or null", "at": "ISO timestamp"}
  ],
  "expecting": {"round": 2, "step": 1, "question": "The IT specialist is now unavailable. Your original response relied on their advice. What would you do next?"},
  "busy": false,
  "clip": {"clip_id": "r2_member_1_step_1", "audio_url": "/api/recordings/r2_member_1_step_1/audio", "text": "caption", "duration_seconds": 17.18},
  "card": {"status": "drafting | draft | confirmed", "fields": {"action": "", "responsibility": "", "evidence": "", "dependencies": "", "fallback": "", "communication": "", "review": ""}},
  "assessment": {
    "stages": [{"step": 1, "max": 20, "points": null, "status": "waiting | scored"}, "... five entries"],
    "total": null, "max": 100, "feedback": null
  },
  "quiz": {
    "status": "generating | ready | failed",
    "current": 2,
    "questions": [
      {"step": 1, "question": "...", "choices": [{"choice_id": "a", "text": "..."}, "... four"],
       "chosen": "c", "points": 15, "max": 20, "deadline": "ISO timestamp or null", "timed_out": false}
    ],
    "total": 15, "max": 100, "question_seconds": 60, "server_time": "ISO timestamp",
    "review": [{"step": 1, "question": "...", "chosen": "c", "points": 15, "timed_out": false,
                "choices": [{"choice_id": "a", "text": "...", "points": 0, "rationale": "..."}, "... four"]}]
  },
  "retryable": false
}
```

1. `round` is 2 for the `coaching` and `card` stages and 3 afterwards; `agent.role` is `coach` then `examiner`.
2. `expecting` is the Round 2 coaching question awaiting a free text answer. Its `question` is self contained: it includes the twist or update shown as a separate message before the question. It is `null` while the agent is busy, during the card stage, throughout Round 3 (no free text), after a failed job, and once the phase has ended.
3. `clip` is the caller's saved fictional answer for the expecting round and step, chosen by seat (the member's index in `game.eligible_member_ids`: 0 leadership, 1 recovery, 2 communications), or `null`. Its `audio_url` is served by `GET /api/recordings/{clip_id}/audio`. Playing it never submits anything.
4. Agent messages carry `source: "canonical"` for server authored text (twist, updates, coaching questions, transition, Round 3 results), the provider for acknowledgements, and `"vertex"` for Round 3 questions. A `pending` placeholder appears while an acknowledgement is being produced; it becomes `ready` or `failed`. Member messages (free text answers, and the chosen choice text in Round 3) have `source: null`.
5. `card` is `null` until drafting starts. `quiz` is `null` before Round 3. `quiz.current` is the question to answer now (1 to 5), or `null` while generating, after a failure and once complete. `quiz.questions` lists only questions already reached (answered ones plus the current one); choices carry only `choice_id` and `text`, and `points` is set once that question is answered. `quiz.review` with every choice's points and rationale is `null` until `stage` is `complete`. `quiz.total` is the server computed sum of earned points. `assessment` is kept for compatibility: five 20 point stages, `total` (`null` before the first pick) and `feedback: null`.
6. `retryable` is `true` when an agent job (acknowledgement, card or quiz generation) failed; nothing else can happen in the branch until it is retried.

### `POST /api/rooms/{room_id}/private-session/answer`

`{"command_id": "UUID", "text": "1 to 1200 characters, not blank", "used_clip": false}`. Returns the session payload with `busy: true`. Returns 409 `not_expecting` when no question is waiting (including after the phase ends) and 409 `agent_busy` while a job runs. Commands are idempotent by `command_id`: a replay returns the current payload, and reusing an ID with a different body returns 409 `command_conflict`. `used_clip` is recorded with the answer for later review. The answer starts an acknowledgement, followed by the next question or, after step 3, the card and then the Round 3 quiz generation. Round 3 has no free text answers.

### `POST /api/rooms/{room_id}/private-session/card`

`{"command_id": "UUID", "fields": {"action", "responsibility", "evidence", "dependencies", "fallback", "communication", "review"}}`, each 1 to 600 characters and not blank. Allowed only when `card.status` is `draft` (otherwise 409 `card_not_ready`) and the phase is active (otherwise 409 `private_session_closed`). The confirmed card replaces the draft, then the transition message and the Round 3 stage 1 question follow. Idempotent by `command_id`.

### `POST /api/rooms/{room_id}/private-session/choice`

`{"command_id": "UUID", "step": 1, "choice_id": "a"}` with `step` 1 to 5 (extra fields forbidden). Records the member's final pick for the current Round 3 question and returns the session payload. Errors: 409 `quiz_not_ready` (not Round 3, generating or failed), 409 `question_timed_out` (that question's time ran out), 409 `already_answered`, 409 `private_session_closed` after the phase ends, 409 `not_current_question` when `step` is not `quiz.current`, 422 `invalid_choice` when `choice_id` is not one of `a` to `d`. Idempotent by `command_id`: a replay returns the current payload, and reusing an ID with a different body returns 409 `command_conflict`.

### Question timer

Each Round 3 question has `QUESTION_SECONDS = 60`, counted from when its question message is posted (the member may answer while the examiner reads it). `deadline` is set for the current question and kept for answered ones; clients compute the remaining time from `deadline` minus `server_time`, which corrects clock skew. When the deadline passes (plus 1.5 seconds of grace for network latency) the question closes with `points: 0`, `chosen: null`, `timed_out: true`, the examiner posts "Question n: time is up, 0 of 20 points." and the next question follows, or the quiz completes after question 5. Expiry runs lazily on every GET and choice and from a scheduled task at the deadline, so it advances even when nobody polls; it is idempotent. A pick for a closed question returns 409 `question_timed_out`. Timed out questions count 0 in the totals.

### Start at Round 3 (test shortcut)

`POST /api/rooms/{room_id}/start` accepts `start_at: "beginning" | "assessment"` (default `"beginning"`), echoed as `game.start_at`. With `"assessment"` (only for timing profiles with private rounds, otherwise 422 `start_at_unavailable`) the game opens directly in `private_session` with every member's stage at `assessment`, and the phase deadline is at least 600 seconds. Earlier rounds are filled with the saved fictional answers from `playtest/fixtures/recordings.json`, by electorate seat: the Round 1 individual decision `r1_member_{seat}_step_1` is recorded in the game state and as that member's private contribution, and the branch replays the canonical Round 2 developments and questions with the answers `r2_member_{seat}_step_{1..3}` (stored with `used_clip: true`), then a response card built by the offline helper from those texts (no model call). The examiner posts "Test start: prerecorded answers were used for Rounds 1 and 2. ..." and every member's quiz job starts at game start. A seat with no saved set starts with an empty history. Completion and the room ending work as after a normal Round 2.

### `POST /api/rooms/{room_id}/private-session/retry`

`{"command_id": "UUID"}`. Retries the failed acknowledgement, card draft or quiz generation when `retryable` is `true`; otherwise 409 `nothing_to_retry`. Submitted answers are always kept. Idempotent by `command_id`.

### Generation and scoring

1. Acknowledgements and the card draft use the same chain as other facilitation text: Vertex Gemini first (JSON output, temperature 0), then the hosted model, then an offline fallback. The offline acknowledgement is a neutral sentence; the offline card splits the member's own decision text into the matching fields and leaves the rest empty for the member to complete.
2. The Round 3 quiz uses Vertex Gemini only (JSON output, LOW thinking, temperature 0.4, up to 12288 output tokens, 90 second timeout), with no hosted or offline fabrication. It is grounded in the public report and documents, the Round 1 discussion and expert panel, the member's role, their own written decision, their coaching answers and their recorded card. Questions test crisis judgment for this scenario and member (authority, facts versus uncertainty, dependencies, fallback, communication, review), never trivia or invented facts. Two live generations on the Cedar Bridge grounding took 13.0 and 14.9 seconds.
3. Validation: exactly 5 questions of 10 to 400 characters, each with exactly 4 choices (text 2 to 300 characters, rationale 1 to 300, whole number points, no duplicate texts); the points are exactly one 0, one 20 and two distinct values strictly between. Invalid output is retried once with the rejection reason; a second failure (or a provider failure) leaves `quiz.status: "failed"` and `retryable`. The server shuffles each question's choices and assigns `choice_id` `a` to `d` in shown order. Points and rationales never leave the server before that question is answered, and other choices' points and every rationale only after completion.

### Private isolation

A member's prompts contain only the public report and public documents, the Round 1 discussion (attributed answers and chat, excluding every individual decision), the expert panel, that member's own Round 1 decision and that member's own private history and card. Other members' decisions and private answers are never included. The GET returns only the caller's branch, and a member can never read another member's session. The points Gemini assigns to each choice are its judgment; validation enforces the points structure, not that the judgment is fair.

### Speech

Every ready agent message has a `speech_id` that works with the existing `POST /api/rooms/{room_id}/facilitation/speech/{speech_id}/prepare` and `GET .../speech/{speech_id}/audio` routes. Speech IDs resolve only within the caller's own branch, so another member gets 404. Speech is generated only when a client calls `prepare`; automated bot clients never call it, so they create no voice cost.

