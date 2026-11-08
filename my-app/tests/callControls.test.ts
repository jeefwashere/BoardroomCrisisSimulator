import test from 'node:test'
import assert from 'node:assert/strict'
import { callControls } from '../src/features/game/callControls.ts'
import type { RoomSnapshot } from '../src/services/rooms.ts'

function room(phase: string, actions: string[] = [], eligible = true): RoomSnapshot {
    return { phase, self_member_id: 'me', members: [{ member_id: 'me', eligible_current_round: eligible }], game: { allowed_actions: actions } } as unknown as RoomSnapshot
}

test('call controls use server grants rather than assuming the visitor is CEO', () => {
    const regular = callControls(room('speaking', ['finish_speaking']))
    assert.equal(regular.canFinish, true)
    assert.equal(regular.canSkipTurn, false)
    assert.equal(regular.canFinishRound, false)
    const ceo = callControls(room('speaking', ['skip_speaker', 'skip_phase']))
    assert.equal(ceo.canSkipTurn, true)
    assert.equal(ceo.canFinishRound, true)
    assert.equal(ceo.canFinish, false)
})

test('finish round is restricted to discussion and never skips a ballot', () => {
    for (const phase of ['briefing', 'reading', 'voting', 'tie_break', 'result', 'ended']) assert.equal(callControls(room(phase, ['skip_phase'])).canFinishRound, false)
    assert.equal(callControls(room('discussion', ['skip_phase'])).canFinishRound, true)
})

test('late observers and completed rounds cannot submit speaking answers', () => {
    assert.equal(callControls(room('speaking', [], false)).canWrite, false)
    assert.equal(callControls(room('speaking')).canWrite, true)
    assert.equal(callControls(room('discussion')).canWrite, true)
    for (const phase of ['voting', 'result', 'ended']) assert.equal(callControls(room(phase)).canWrite, false)
    assert.equal(callControls(room('result')).reviewing, true)
    assert.equal(callControls(room('ended')).reviewing, true)
})
