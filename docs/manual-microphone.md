# Manual microphone recording

The microphone control records only the authenticated participant's current speaking turn. Recording starts with an explicit button press. The user can stop capture and save the original without changing the authoritative speaking schedule. Later turns require another explicit start.

Stopping releases every acquired audio track and asks MediaRecorder to emit its final data before the original is uploaded. Permission and grant responses which arrive after cancellation or a phase change cannot restart capture. Leaving or losing the turn, the deadline, the size limit and authority checks also stop capture.

The existing backend allows one immutable original per member and speaking phase. A saved original locks another capture for that turn. Failed upload bytes and their recording identity remain available for an explicit exact retry; another capture must not overwrite them. An existing server receipt recovers an already accepted original without repeating transcription.

This control does not change providers, prices, runtime voice settings, authority or game timing. Original audio can be retained while transcription is disabled. The existing owner transcript review, authenticated playback and final evidence remain available.

## Verification

Clean install, build, lint and all 103 frontend tests pass, including fourteen new lifecycle cases. An independent read only source review and the fourteen focused cases found no remaining blocker after correcting failed startup cleanup and matching expired attempt retirement. The existing 31 Python tests, seven narration player tests and authored offline demo pass. Backend and prototype source are unchanged.

Actual browser acceptance used three independent tabs, a synthetic oscillator MediaStream, the real MediaRecorder and existing authenticated recording endpoints. Manual Stop released every captured track immediately and saved one original. The server decoded 2.157 seconds and reported transcription disabled. Authenticated playback loaded with readyState 4. Permission denial remained visible, a late permission stream was released after Cancel, other players could not record the active speaker, and the next own turn did not request the microphone automatically. Desktop and 390 pixel mobile screenshots were visually inspected without overflow.

Initial harness errors in a stale label and controlled clock fixture were retained. The accepted run uses atomic clock file replacement and presence preserving steps, without modifying product timing or adding routes. All twelve owned browser targets, the exact lease, managed browser and both disposable services were cleaned up. See [sanitized evidence](evidence/manual-microphone-20261108.json). No paid provider or physical microphone was used.

The run uses the standing user supplied thirty minute ceiling from 2026 November 8 at 01:18:20 UTC through 01:48:20 UTC. Shared frontend activation follows reviewed publication while preserving the backend and existing rooms.

## Existing boundaries

The backend has no grant cancellation route. Cancelling after a grant is accepted but before audio exists can leave that grant pending until its original deadline plus sixty seconds; final feedback then identifies the missing upload. Recovering such a grant preserves its initial grant timestamps, not an independently measured later physical microphone onset. This change does not add a cancellation endpoint or claim physical microphone hardware acceptance.

Failed upload bytes remain in the current page controller. Leaving or refreshing before acknowledgement can lose retry access; finish saving or retry while that page remains open. A final upload already in progress continues against its captured room identity, never a newly visited room.
