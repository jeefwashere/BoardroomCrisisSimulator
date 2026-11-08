# Personal discussion answer draft

## Confirmed behavior

Each participating member receives a private answer draft during an individual decision scenario. It summarizes that member's own saved discussion text and reviewed microphone transcript. It does not add recommendations or infer agreement from another participant. Generation never submits an answer or finishes a turn.

The same editable text continues from speaking through expert discussion and the decision phase. Untouched text follows newer summaries automatically. After the first manual edit or dictation, newer summaries appear as suggestions. Only the member can choose to replace their text with a suggestion. The existing explicit decision command remains the final submission boundary. The last required submission may close decisions immediately, and the existing timeout and host controls remain authoritative.

## Usage and shape

```tsx
const draft = useDiscussionDraft(room)
// Both discussion preview and decision form consume this one controller.
draft.edit('My own revised answer')
draft.useSuggestion()
// Only the existing explicit submit action commits the visible text.
await act(`rounds/${room.game.round_id}/decision`, { text: draft.state.text })
```

```text
POST /api/rooms/{room_id}/discussion-summary
{command_id, round_id, retry: false}

Response: room_id, round_id, member_id, status, evidence_revision,
          text, source, evidence_count, error
```

The backend owns source selection, authenticated membership, evidence fingerprints and generated artifacts. It reads original contribution and reviewed recording records directly. The browser owns editable text in one round scoped controller. Tab scoped storage includes room, started game, round and member identity. Reload recovery applies to the same tab and device; it is not cross device draft synchronization. Existing rooms remain process memory and do not survive a backend restart.

Generation captures evidence under the room lock, runs outside that lock, then checks the current room, round, phase, member eligibility and evidence fingerprint before publishing. Unchanged evidence shares one pending or completed result. A failed attempt cannot cause repeated paid calls from polling. New evidence coalesces while a job is pending. Models receive attributed source data as data, with instructions for a concise faithful summary and no invented actions.

## Synthesis decision

Two independent inherited model agents designed structurally different candidates. The available runner catalog does not include the alternate model families requested by the architecture skill, so a different family judge was unavailable. The coordinator compared both complete candidates against member isolation, editing races, reviewed audio ownership, reload recovery and implementation size.

The client owned editable buffer is the base. It fits the existing local decision editor and keeps a small backend API without introducing save revisions and suggestion acceptance endpoints. From the server owned candidate, retain exact evidence fingerprints, one pending job, explicit failure retry, direct recording reads and stale publication checks. Reject server owned keystroke persistence for this scope because cross device editing has not been requested. Reject reusing the existing auto response hook because that hook commits contributions and may finish a turn automatically.

Both candidates preserve the same review authority: recording audio alone is not a reviewed contribution. Summaries update after sent text or a completed and reviewed speaking turn, rather than after every partial syllable. The existing browser recorder and backend file transcription match the distinct recording and recognition operations described by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) and [ElevenLabs](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).

## Validation record

Implementation checks and activation evidence will be recorded here after execution. Synthetic audio proves the transport and recognition path only. Physical microphone and other device acceptance require those devices to be tested.
