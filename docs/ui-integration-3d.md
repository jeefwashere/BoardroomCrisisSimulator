# UI integration guide (for the 3D front end)

This describes the current 2D call UI on `test-ui` / `integration/unified-game` and every backend signal it
uses, so a 3D scene (avatars round a boardroom table) can replace the stage without changing game logic.
Rule of thumb: **the 3D scene replaces the "call stage" (the tiles). Keep the bottom control bar, the live
transcript panel and all the hooks.** Exact payloads are in `my-app/src/services/rooms.ts` and
`my-app/src/services/facilitation.ts`.

## 1. Game flow (Cedar Bridge T01, solo mode)

| Phase (`room.phase`) | What happens | Who talks (drive avatar animation) |
|---|---|---|
| `briefing` | AI opening briefing, Gemini text + ElevenLabs voice | Preparation agent |
| `speaking` | **9 turns**: Alex → Morgan → Sam, three times round (`speaking_rounds: 3`), 30 s each | `game.active_speaker_id` |
| `discussion` (`game.discussion_mode === 'experts'`) | Expert panel: IT and security, Operations and community services, Governance and finance | the expert whose audio is playing |
| `individual_decision` | Each member writes one decision (typed or dictated), prompt pinned in the chat drawer | nobody |
| `private_session` | Round 2 coaching then Round 3 scored assessment, one to one with the "Crisis coach" | coach or you |
| `ended` | Centered report: decision, response card, score 0 to 100 with per criterion feedback | nobody |

You play Alex (CEO). Morgan (IT recovery lead) and Sam (Communications lead) are bots run by the parent page
(`features/demo/useSoloBots.ts`, `usePrivateBots.ts`). Solo demo URL: `#/demo`, button "Start solo game as Alex".

## 2. Layout contract

```
┌───────────────────────────────────────────────┬────────────────────┐
│ CALL STAGE  ← replace with the 3D scene        │ LIVE TRANSCRIPT    │
│ (tiles only, never text)                       │ (CC on) or CHAT    │
│                                                │ one panel at a time│
├───────────────────────────────────────────────┴────────────────────┤
│ CONTROL BAR: status · Mic/Dictate · Chat · Captions · Auto response │
│              · Finish my turn · Skip · Skip speaker · End           │
└─────────────────────────────────────────────────────────────────────┘
```

* No text on the stage in any phase. All speech goes to the transcript; the stage only shows who is talking.
* Captions (CC) default on, remembered in `sessionStorage['boardroom.captions']`. Opening Chat replaces the
  transcript; closing it brings the transcript back.
* No browser `prompt`/`confirm` dialogs. End uses a two click arm button.
* In the private session, the answer box (question, textarea, Submit) sits at the bottom of the transcript panel;
  with CC off it floats at the bottom of the stage. The 3D version must keep one of these visible.
* Small faint "Reset demo" button top right in solo mode (needed after a backend restart: rooms are in memory).

## 3. "Who is talking" signals (what animates an avatar)

| Speaker | Signal | Audio source |
|---|---|---|
| Preparation agent | `briefing` phase and the opening audio is playing (`OpeningBriefing.tsx`) | `GET /api/rooms/{id}/facilitation` → `opening.speech_id`, then `POST …/facilitation/speech/{speech_id}/prepare` and `GET …/audio` |
| A member (turns) | `room.phase === 'speaking'` and `game.active_speaker_id` | Bots: clip for that turn plays on the parent page. You: Auto response clip or your mic |
| Expert | the expert take being played (`ExpertPanelStage.tsx`), `facilitation.expert_panel.experts[]` | each take's `speech_id` via the same speech endpoints |
| Crisis coach | a coach message (`author: 'agent'`) audio is playing (`PrivateSessionStage.tsx`) | message `speech_id` via the same speech endpoints |
| You (private) | your Auto response clip playing, or dictation listening | `session.clip.audio_url`, or the mic |

Turn bookkeeping: `game.speaker_order` (9 entries, members repeat) and `game.speaker_index` (0 to 8, null outside
`speaking`). **Do not key avatars or lists by member id alone in the order**, use the index. A new
`game.phase_id` is created for every turn, so `phase_id + active_speaker_id` identifies one turn (`turnKey`).

Seat → role: `game.eligible_member_ids[0]` Alex/leadership, `[1]` Morgan/recovery, `[2]` Sam/communications.

## 4. Recorded clips (prerecorded voices)

`GET /api/recordings` returns the catalog (67 clips): `{clip_id, group, speaker, text, duration_seconds, audio_url}`.

* Round 1 turns: `t01_dialogue_01` to `t01_dialogue_09`, one per turn, picked by `clipForTurn(game, catalog, memberId)`
  in `features/game/savedClips.ts` (`speaker_index + 1`). Falls back to the member's single
  `t01_leadership_turn` / `t01_recovery_turn` / `t01_communications_turn` clip if the order does not loop.
* Rounds 2 and 3: `r2_member_{n}_step_{1..3}`, `r3_member_{n}_step_{1..3}`, served per question as `session.clip`.
* `text` is the exact caption: show it in the transcript while the clip plays (typewriter at the audio's pace).

## 5. Live transcript

* Model: `features/game/transcriptModel.ts` (pure, unit tested). Entry: `{id, speaker, role, tone, text, live, reveal}`,
  tones `agent | expert | coach | self | member | system`, max 300 entries.
* Hook: `useTranscript(sessionKey)` in `features/game/useTranscript.ts` returns `{entries, writer}`. The writer has
  `upsert(entry)`, `speak(entry, durationMs, elapsedMs?)` and `done(id)`. `useLiveSpeech` and `useSpokenLine`
  keep exactly one line "Speaking" and end it on unmount or skip.
* Session key is `room_id:game.started_at`, so every new game starts with an empty transcript.
* The 3D scene should call the same writer when it starts and stops a voice, so captions stay in sync.
  Unknown audio length falls back to 15 characters per second.
* View: `features/game/TranscriptPanel.tsx` (dark right panel, auto scroll, "Speaking" dot).

## 6. Controls → API

All room commands are `POST /api/rooms/{room_id}/…` with a `command_id` and the current `phase_id`
(see `roomApi` in `services/rooms.ts`). Buttons only render when `game.allowed_actions` allows them.

| Control | Call |
|---|---|
| Auto response (your turn) | play your clip, then `POST contributions` `{kind: 'answer', source: 'typed', text: caption}`, then `POST rounds/{round_id}/speaker/finish` (`useAutoResponse.ts`) |
| Finish my turn | `POST rounds/{round_id}/speaker/finish` |
| Skip (host) | `POST rounds/{round_id}/skip-phase` (briefing goes straight to turns) |
| Skip speaker (host) | `POST rounds/{round_id}/speaker/skip` |
| End (host) | `POST end` |
| Mic / Dictate | browser Web Speech (`useDictation.ts`, `createSpeechReader` dedupes phrases) fills the active text box |
| Round 1 decision | `POST rounds/{round_id}/decision` with one text (max 2000 chars, `DECISION_LIMIT`) |
| Private answer | `POST private-session/answer` `{text, used_clip}`; Auto response plays `session.clip` then submits its text (`usePrivateAutoResponse.ts`) |
| Private retry | `POST private-session/retry` when `session.retryable` |

Poll `GET /api/rooms/{room_id}` for the snapshot and `GET /api/rooms/{room_id}/private-session` (every 1.2 s) in
Rounds 2 and 3.

## 7. Private session (Rounds 2 and 3)

`GET /api/rooms/{id}/private-session` → `{round, stage, agent, messages[], expecting, busy, clip, card, assessment, retryable}`.

* `stage`: `coaching` → `card` (Gemini is recording the card, show "Crisis coach is recording your response card…")
  → `assessment` → `complete`. There is no card review screen: the card is drafted live by Gemini from your three
  coaching answers, confirmed automatically, and Round 3 starts.
* `agent.role`: `coach` (Round 2, label "Crisis coach") or `examiner` (Round 3, "Crisis coach · examiner").
* `messages`: twist, questions, Gemini acknowledgements, updates, transition, your answers. Agent messages carry a
  `speech_id`; put each into the transcript as its audio plays.
* `expecting`: the question waiting for an answer, null while the coach is speaking or busy.
* `assessment`: three stages 30/40/30 (total 100), scored by Gemini with quote checked evidence. `feedback`
  (per criterion reasons and quotes) is released only when `stage === 'complete'`.
* Stage strip for the 3D scene: round pill, private badge, countdown, and in Round 3 the score and three stage chips.

## 8. What is fixed text vs live AI

Live Gemini: opening briefing, expert takes, coach acknowledgements, the response card, Round 3 scores and reasons.
Fixed by design (beta mode, matches the prerecorded answers): the coach's questions, twist, updates and the
"Your preparation is complete…" transition. Voices: ElevenLabs, generated on demand through the speech endpoints.

## 9. File map (`my-app/src`)

| Area | Files |
|---|---|
| Screen and layout | `pages/Game.tsx`, `pages/Game.css` |
| Tiles (replace with 3D) | `features/game/CallTile.tsx` (`CallTile`, `MemberTile`, `MemberStrip`, `TalkingBars`, `VoiceOrb`), `CallGrid.tsx` |
| Phase stages | `OpeningBriefing.tsx`, `ExpertPanelStage.tsx`, `PrivateSessionStage.tsx`, `IndividualDecisionPanel` (in chat drawer) |
| Transcript | `transcriptModel.ts`, `useTranscript.ts`, `TranscriptPanel.tsx` |
| Controls | `ControlBar.tsx`, `controlBarModel.ts`, `ChatDrawer.tsx`, `useDictation.ts` |
| Voices and clips | `savedClips.ts`, `useAutoResponse.ts`, `usePrivateAutoResponse.ts`, `services/facilitation.ts` |
| Private session | `usePrivateSession.ts`, `privateSessionModel.ts`, `PrivateSessionReport.tsx` |
| Solo demo and bots | `features/demo/DemoRoom.tsx`, `useSoloBots.ts`, `usePrivateBots.ts` |

Only one browser tab should play sound: in the solo demo only seat `alex` plays audio (`PLAYS_VOICE`); open
several tabs and you hear echoes.

## 10. Suggested 3D integration steps

1. Mount the 3D canvas where `Game.tsx` renders the call stage (`.game-live-main` stage area). Keep the control
   bar, transcript and chat drawer as they are.
2. Map seats to avatars with `eligible_member_ids`; add avatars for the Preparation agent, the three experts and
   the Crisis coach (or one AI presenter that changes role).
3. Drive a `talking` flag per avatar from section 3 (the same booleans the tiles use for `talking`).
4. Reuse the existing hooks for audio; do not start audio from the 3D layer as well, or captions and turn
   commits will double.
5. Run `cd my-app && npm run build && npm run lint && npm test` (218 tests) before pushing.

## 11. Implemented 3D stage (solo demo)

The 3D boardroom now runs inside `my-app` as an alternative stage. Open `#/demo`, keep **Stage: 3D boardroom** (the
default for solo games) and press "Start solo game as Alex". Alex's frame loads with `?seat=alex&view=3d`; any room URL
accepts `view=3d`.

Switching: the **3D view** button in the control bar flips between the 3D boardroom and the call tiles live, in any
phase, without reloading; the transcript, audio, turn and chat carry on. The choice is remembered for the tab
(`sessionStorage['boardroom.stageView']`, shared with the demo setup's Stage option) and wins over `view=` in the URL.
Once opened, the scene stays loaded and only pauses rendering while the call view shows, so switching back is
instant. The button appears when the room has at most three members, since the 3D table seats three.

* Three characters only: Alex at the head of the full size 4.2 m table, Morgan and Sam on opposite sides, offset along
  the table (about 2.1 m, 2.5 m and 3.5 m apart). Seats follow `eligible_member_ids`.
* The table hub is the AI agents' seat. While the preparation agent, an expert or the crisis coach is speaking, the
  hub ring brightens, a light column rises, a voice orb pulses and a warm light falls on the table, in the expert's
  accent colour where one exists. The hub keeps a soft standby glow during agent phases.
* Presenter camera: a close shot across the table of whoever is talking (or holding the turn), an over the shoulder
  shot of the hub while an agent talks, and the overview otherwise. Dragging steers the camera; it resumes presenting
  10 seconds after the last drag, and a double click resumes at once.
* Moods: talking members play the talking clip, everyone types during individual decisions, and in private sessions
  Morgan and Sam work at their laptops. Heads turn toward the speaker or the hub.
* Faces: the three characters (`01-coo` Alex, `03-cto` Morgan, `02-cfo` Sam) are face rigged with six morph targets
  and a mouth interior. `features/boardroom3d/faceExpressions.ts` blinks every 2 to 6 seconds, and while a member
  talks opens the mouth moderately (at most 0.32; procedural lip flap, since the scene receives no audio level) with a
  warm smile that swells and settles and brow accents every couple of seconds; heads lift toward what they look at, so
  the speaker faces the presenter camera instead of the laptop; raises listeners' brows while a colleague or an AI agent talks, frowns in thought
  during individual decisions and voting, stays composed in private sessions, looks alert in the briefing and smiles
  in the lobby and at the end. In Round 3, `QuizStage` reports each closed question through `emitFaceReaction`: your
  own character frowns at a wrong answer (or a timeout), smiles a little at a partly right one and smiles broadly at
  the best one, while the camera turns to face them for three seconds and then returns to the room. `npm run dev`
  serves `/face-preview.html`, a dev only page with the real scene and a fake room state (and, with Round 3 quiz on,
  the real quiz card with fake questions) for checking faces without a backend.
* No spoken text on the stage. The wall screen shows only the scenario title, the phase and the clock; name tags
  show names, roles and a talking indicator.

How it is wired, following section 10: the stage components report their talking agent through
`features/boardroom3d/agentPresence.ts` (`useReportAgent`), with the same booleans their tiles use. `Game.tsx`
builds the scene state with `boardroomView` (`features/boardroom3d/boardroomModel.ts`, unit tested in
`tests/boardroom3d.test.ts`) and mounts `Boardroom3D.tsx` behind the stage overlays; tiles are hidden, while stage
heads, buttons, notices, the transcript, the private answer box and the control bar are unchanged. Audio still
plays only from the existing hooks. The scene (`Boardroom.ts`, `SeatTags.ts`) is ported from
`game-ui/src/scene` on `arjun/game-ui-3d` and loads on demand, so the call view never downloads three.js. Models
are in `my-app/public/models` (3 face rigged characters, the baked room and the props) and `my-app/public/textures/sky`.
