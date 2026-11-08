import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeText, chatUnread, formatClock, micControl, offersReport, othersCount, phaseCaption, phaseTitle, recordingsToReview, skipLabel } from '../src/features/game/controlBarModel.ts'
import type { MicInput } from '../src/features/game/controlBarModel.ts'
import { DICTATION_UNAVAILABLE } from '../src/features/game/dictationModel.ts'

test('skip labels follow the phase, with a generic fallback', () => {
    assert.equal(skipLabel('briefing'), 'Skip briefing')
    assert.equal(skipLabel('speaking'), 'Skip remaining turns')
    assert.equal(skipLabel('discussion'), 'Skip to decisions')
    assert.equal(skipLabel('individual_decision'), 'Close decisions')
    assert.equal(skipLabel('voting'), 'Record final decision')
    assert.equal(skipLabel('something_new'), 'Skip phase')
})

test('phase pill names the phase or who holds the floor', () => {
    assert.equal(phaseTitle('individual_decision'), 'Decisions')
    assert.equal(phaseTitle('tie_break'), 'Tie break')
    assert.equal(phaseTitle('ended'), 'Ended')
    assert.equal(phaseCaption('speaking', { name: 'Morgan', self: false }), 'Morgan speaking')
    assert.equal(phaseCaption('speaking', { name: 'Alex', self: true }), 'Your turn')
    assert.equal(phaseCaption('speaking', null), 'Speaking')
    assert.equal(phaseCaption('voting', { name: 'Morgan', self: false }), 'Voting')
})

test('countdown clock shows minutes and padded seconds', () => {
    assert.equal(formatClock(0), '0:00')
    assert.equal(formatClock(42), '0:42')
    assert.equal(formatClock(725), '12:05')
    assert.equal(formatClock(-3), '0:00')
})

test('unread chat counts only other members\' messages after the last seen count', () => {
    const records = [{ member_id: 'me' }, { member_id: 'a' }, { member_id: 'b' }, { member_id: 'me' }, { member_id: 'a' }]
    assert.equal(othersCount(records, 'me'), 3)
    assert.equal(chatUnread(records, 'me', 1), 2)
    assert.equal(chatUnread(records, 'me', 3), 0)
    assert.equal(chatUnread(records, 'me', 10), 0)
    assert.equal(othersCount([{ member_id: 'a', kind: 'chat' }, { member_id: 'a', kind: 'answer' }, { member_id: 'me', kind: 'chat' }], 'me'), 1)
    assert.equal(badgeText(4), '4')
    assert.equal(badgeText(12), '9+')
})

test('only your own unreviewed transcripts surface for review', () => {
    const recordings = [
        { member_id: 'me', transcript: 'my words', reviewed_text: null },
        { member_id: 'me', transcript: 'done', reviewed_text: 'done' },
        { member_id: 'me', transcript: '  ', reviewed_text: null },
        { member_id: 'other', transcript: 'theirs', reviewed_text: null },
    ]
    assert.deepEqual(recordingsToReview(recordings, 'me').map((item) => item.transcript), ['my words'])
})

const idle = { status: 'idle' as const, message: 'Microphone off.', retryUpload: false }
const noDictation = { supported: true, listening: false, blocked: false, ready: false }
const input = (change: Partial<MicInput>): MicInput => ({ phase: 'speaking', phaseId: 'p1', ownTurn: false, recording: idle, dictation: noDictation, ...change })

test('mic records only during your own speaking turn, red while recording', () => {
    assert.deepEqual(micControl(input({ ownTurn: true })), { action: 'start', label: 'Mic', title: 'Start recording your turn', live: false, muted: true })
    const others = micControl(input({}))
    assert.equal(others.action, null)
    assert.match(others.title, /your own speaking turn/)
    assert.equal(micControl(input({ phase: 'voting' })).action, null)
    const live = micControl(input({ ownTurn: true, recording: { status: 'recording', message: 'on', retryUpload: false, phaseId: 'p1' } }))
    assert.equal(live.action, 'stop')
    assert.equal(live.live, true)
    assert.equal(micControl(input({ ownTurn: true, recording: { status: 'requesting', message: 'asking', retryUpload: false } })).action, 'cancel')
    assert.equal(micControl(input({ ownTurn: true, recording: { status: 'saving', message: 'saving', retryUpload: false } })).action, null)
    assert.equal(micControl(input({ ownTurn: true, recording: { status: 'error', message: 'kept', retryUpload: true } })).action, 'retry')
    // One original per turn: a saved turn disables the mic until the next turn.
    const saved = micControl(input({ ownTurn: true, recording: { status: 'saved', message: 'saved', retryUpload: false, phaseId: 'p1' } }))
    assert.equal(saved.action, null)
    assert.equal(saved.label, 'Saved')
    assert.equal(micControl(input({ ownTurn: true, phaseId: 'p2', recording: { status: 'saved', message: 'saved', retryUpload: false, phaseId: 'p1' } })).action, 'start')
})

test('during individual decisions the mic toggles dictation into the decision box', () => {
    const decide = (dictation: Partial<MicInput['dictation']>) => micControl(input({ phase: 'individual_decision', dictation: { ...noDictation, ...dictation } }))
    assert.equal(decide({ ready: true }).action, 'dictate')
    assert.equal(decide({ ready: true }).label, 'Dictate')
    const listening = decide({ ready: true, listening: true })
    assert.equal(listening.action, 'stop-dictation')
    assert.equal(listening.live, true)
    assert.equal(decide({ ready: false }).action, null)
    assert.equal(decide({ ready: true, supported: false }).title, DICTATION_UNAVAILABLE)
    assert.equal(decide({ ready: true, blocked: true }).action, null)
    // The turn recorder state is irrelevant while deciding.
    assert.equal(micControl(input({ phase: 'individual_decision', ownTurn: true, dictation: { ...noDictation, ready: true } })).action, 'dictate')
})

test('private sessions: skip label, own round caption and dictation into the answer box', () => {
    assert.equal(skipLabel('private_session'), 'End private sessions')
    assert.equal(phaseCaption('private_session', null, 2), 'Private coaching')
    assert.equal(phaseCaption('private_session', null, 3), 'Assessment')
    assert.equal(phaseCaption('private_session', null), 'Private coaching')
    const answer = (dictation: Partial<MicInput['dictation']>) => micControl(input({ phase: 'private_session', dictation: { ...noDictation, ...dictation } }))
    assert.equal(answer({ ready: true }).action, 'dictate')
    assert.match(answer({ ready: true }).title, /answer box/)
    assert.equal(answer({ ready: true, listening: true }).action, 'stop-dictation')
    assert.equal(answer({ ready: false }).action, null)
    assert.match(answer({ ready: false }).title, /coach asks/)
})

test('the Report button is offered only in the opening session', () => {
    assert.equal(offersReport('briefing'), true)
    assert.equal(offersReport('reading'), true)
    assert.equal(offersReport('speaking'), false)
    assert.equal(offersReport('individual_decision'), false)
    assert.equal(offersReport('private_session'), false)
    assert.equal(offersReport('ended'), false)
})
