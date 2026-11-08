import test from 'node:test'
import assert from 'node:assert/strict'
import { PARTICIPANT_CLIP_IDS, assignSavedClips, cardStatus, clipForMember, commitEligibility, isOwnTurn, turnKey } from '../src/features/game/savedClips.ts'
import type { TurnView } from '../src/features/game/savedClips.ts'
import type { RecordedClip } from '../src/services/facilitation.ts'

function clip(clip_id: string, group = 'participant', text = `Caption for ${clip_id}.`): RecordedClip {
    return { clip_id, group: group as RecordedClip['group'], label: clip_id, speaker: 'Participant', text, duration_seconds: 14, audio_url: `/api/recordings/${clip_id}/audio` }
}

const catalog = [clip('t01_decision_prompt', 'decision_guide'), clip('t01_communications_turn'), clip('t01_leadership_turn'), clip('t01_recovery_turn'), clip('facilitator_open', 'facilitator')]
const speaking = (activeSpeakerId: string | null, selfId = 'a', phaseId = 'p1'): TurnView => ({ phase: 'speaking', phaseId, activeSpeakerId, selfId })

test('the three participant clips are assigned by eligible index and later members get none', () => {
    const assignments = assignSavedClips(['a', 'b', 'c', 'd'], catalog)
    assert.deepEqual(assignments.map((item) => [item.memberId, item.seat, item.clip.clip_id]), [
        ['a', 0, 't01_leadership_turn'], ['b', 1, 't01_recovery_turn'], ['c', 2, 't01_communications_turn'],
    ])
    assert.equal(clipForMember(assignments, 'd'), null)
    assert.equal(clipForMember(assignments, 'b')?.clip_id, 't01_recovery_turn')
    assert.deepEqual([...PARTICIPANT_CLIP_IDS], ['t01_leadership_turn', 't01_recovery_turn', 't01_communications_turn'])
})

test('fewer members or a missing clip leaves those seats without a card', () => {
    assert.deepEqual(assignSavedClips(['a'], catalog).map((item) => item.clip.clip_id), ['t01_leadership_turn'])
    assert.deepEqual(assignSavedClips(['a', 'b', 'c'], catalog.filter((item) => item.clip_id !== 't01_recovery_turn')).map((item) => item.memberId), ['a', 'c'])
    assert.deepEqual(assignSavedClips(['a', 'b', 'c'], []), [])
    assert.deepEqual(assignSavedClips(['a'], [clip('t01_leadership_turn', 'reference')]), [], 'only participant group clips count')
})

test('turn identity, own turn and card status follow the active speaker', () => {
    assert.equal(turnKey(speaking('a')), 'p1:a')
    assert.equal(turnKey({ ...speaking('a'), phase: 'voting' }), null)
    assert.equal(turnKey(speaking(null)), null)
    assert.equal(isOwnTurn(speaking('a')), true)
    assert.equal(isOwnTurn(speaking('b')), false)
    assert.equal(isOwnTurn({ ...speaking('a'), phase: 'discussion' }), false)
    assert.deepEqual(cardStatus(speaking('b'), 'b'), { label: 'SPEAKING NOW', speaking: true })
    assert.deepEqual(cardStatus(speaking('b'), 'a'), { label: 'Waiting for turn', speaking: false })
    assert.deepEqual(cardStatus({ ...speaking('b'), phase: 'reading' }, 'b'), { label: 'Waiting for turn', speaking: false })
})

test('commit needs your own live turn, your clip and a full playback in this same turn', () => {
    const own = clip('t01_leadership_turn')
    assert.deepEqual(commitEligibility({ view: speaking('a'), clip: own, finishedTurn: 'p1:a', busy: false }), { allowed: true, reason: '' })
    assert.equal(commitEligibility({ view: speaking('a'), clip: own, finishedTurn: null, busy: false }).allowed, false, 'playback must finish first')
    assert.equal(commitEligibility({ view: speaking('b'), clip: own, finishedTurn: 'p1:a', busy: false }).allowed, false, 'speaker changed')
    assert.equal(commitEligibility({ view: speaking('a', 'a', 'p2'), clip: own, finishedTurn: 'p1:a', busy: false }).allowed, false, 'phase changed')
    assert.equal(commitEligibility({ view: { ...speaking('a'), phase: 'voting' }, clip: own, finishedTurn: 'p1:a', busy: false }).allowed, false, 'not speaking')
    assert.equal(commitEligibility({ view: speaking('a'), clip: null, finishedTurn: 'p1:a', busy: false }).allowed, false, 'no assigned clip')
    assert.equal(commitEligibility({ view: speaking('a'), clip: clip('t01_leadership_turn', 'participant', '  '), finishedTurn: 'p1:a', busy: false }).allowed, false, 'empty caption')
    assert.equal(commitEligibility({ view: speaking('a'), clip: own, finishedTurn: 'p1:a', busy: true }).allowed, false, 'busy')
    assert.match(commitEligibility({ view: speaking('a', 'a', 'p2'), clip: own, finishedTurn: 'p1:a', busy: false }).reason, /previous turn/)
})
