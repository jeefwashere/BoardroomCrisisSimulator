# Personal discussion answer draft

## Confirmed behavior

Each participating member receives a private answer draft during an individual decision scenario. It summarizes that member's own saved discussion text and reviewed microphone transcript. It does not add recommendations or infer agreement from another participant. Generation never submits an answer or finishes a turn.

The same editable text continues from speaking through expert discussion and the decision phase. Untouched text follows newer summaries automatically. After the first manual edit or dictation, newer summaries appear as suggestions. Only the member can choose to replace their text with a suggestion. The existing explicit decision command remains the final submission boundary. The last required submission may close decisions immediately, and the existing timeout and host controls remain authoritative.

## Usage and shape

```tsx
const draft = useDiscussionDraft(room)
// Both discussion preview and decision chat composer consume this one controller.
draft.edit('My own revised answer')
draft.accept()
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

The original feature passed 247 frontend tests, build and lint, plus 29 targeted backend tests. A real synthetic eight second fixture passed the backend recording upload, ElevenLabs transcription, explicit owner review and Vertex summary path. It selected exactly two own sources, returned an empty artifact to a different member and left gameplay in speaking without a submitted decision. The existing shared voice ledger increased from US$0.0765066667 to US$0.0831733333 against the previously authorized US$100 ceiling. The conservative reservation is not a provider billing receipt. See [live evidence](evidence/personal-draft-live-20261108.json).

A disposable browser game verified automatic text fill, human edit protection, explicit suggestion acceptance, own member isolation, same tab reload, phase continuity, explicit final confirmation and retained unsent changes after decisions close. A responsive toolbar overlap was reproduced and repaired by measuring the actual toolbar height. The original complete backend run retained its three failures and five errors in the private session and narration fixtures, with six additional timing dependent errors from one thirty member TestClient test. The unchanged baseline reproduced the original eight failures; its thirty member test passed on that run. These results are not a fully passing backend suite.

Remote test UI advanced to03810f9 during development. Its quiz sounds, assessment start selection and compact chat based decision UI are integrated before final checks. Final merged checks and publication follow below. The user requested branch publication only, so the current live game service is not changed.

Synthetic audio proves the transport and recognition path only. Physical microphone and other device acceptance require those devices to be tested. Live STT remains deployment configuration gated and was enabled only inside the bounded acceptance process. No key, budget ledger or runtime flag is distributed to browsers.


Final merged verification: all255 frontend tests, production build and lint pass. The24 backend summary, recording and transport regressions pass. The complete backend run executes228 tests with4 failures and7 errors. An independent clean03810f9 upstream private session and narration run reproduces exactly those11 failure identities, with no additional feature failure. No tests were weakened. Current branch publication follows user instruction without a main merge or live service restart.


The final merged browser run again passes source fill, manual protection, suggestion acceptance, reload recovery, private decision composer prefill, explicit three member confirmations and unsent copy retention after closure. It reports zero page errors. The actual toolbar clearance repair keeps Send clickable. A narrow screenshot was inspected; the existing demo toolbar can still scroll horizontally, so this is not a complete mobile layout acceptance. Test pages, the exact browser lease and disposable servers are cleaned up. See [browser record](evidence/personal-draft-browser-20261108.json).


Final toolbar correction: review of the disposable Vite log caught a ResizeObserver observation error that the pageerror listener did not capture. The callback now coalesces writes into one animation frame, writes only changed heights and cancels pending work on cleanup, following [MDN observation error guidance](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors). A fresh browser captured window errors and console errors while resizing five times between390 and1440 pixels. Every measured drawer bottom matched the toolbar top, Send remained clickable, and both error lists were empty. Build and lint pass after this correction. See [toolbar regression evidence](evidence/personal-draft-toolbar-20261108.json). Both disposable servers and the second exact browser lease are closed.
