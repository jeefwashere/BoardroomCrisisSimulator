import test from 'node:test'
import assert from 'node:assert/strict'
import {
    SUGGESTED_QUESTIONS, adviserInitials, askAvailability, askerName, decisionGuideClip, formatDuration, groupClips,
    hasOwnPending, mergeConsultation, orderConsultations, progressFraction, replySourceLabel,
} from '../src/features/facilitation/facilitationModel.ts'
import type { Consultation, RecordedClip } from '../src/services/facilitation.ts'
import type { RoomMember } from '../src/services/rooms.ts'

function clip(clip_id: string, group: string): RecordedClip {
    return { clip_id, group: group as RecordedClip['group'], label: clip_id, speaker: 'Speaker', text: '', duration_seconds: 3, audio_url: `/api/recordings/${clip_id}/audio` }
}

function consultation(fields: Partial<Consultation> & { consultation_id: string }): Consultation {
    return { kind: 'it', member_id: 'm1', round_number: 1, phase: 'discussion', question: 'Q?', status: 'ready', reply: 'A.', source: 'hosted', speech_id: null, error: null, at: '2026-01-01T10:00:00Z', ...fields }
}

test('clips are grouped in the fixed display order with the decision guide first', () => {
    const groups = groupClips([
        clip('ref', 'reference'), clip('disc1', 'discussion'), clip('guide', 'decision_guide'), clip('it1', 'adviser'),
        clip('turn1', 'participant'), clip('j1', 'journalist'), clip('disc2', 'discussion'), clip('ctl', 'control'), clip('fac', 'facilitator'),
    ])
    assert.deepEqual(groups.map((group) => group.label), ['Decision guide', 'Participant turns', 'Facilitator', 'IT adviser', 'Journalist', 'Discussion examples', 'Control', 'Reference'])
    assert.deepEqual(groups.find((group) => group.group === 'discussion')?.clips.map((item) => item.clip_id), ['disc1', 'disc2'])
})

test('unknown clip groups are kept after the known groups with a readable heading', () => {
    const groups = groupClips([clip('x', 'bonus_material'), clip('fac', 'facilitator')])
    assert.deepEqual(groups.map((group) => group.label), ['Facilitator', 'Bonus material'])
    assert.deepEqual(groupClips([]), [])
})

test('the decision guide clip is found when present', () => {
    assert.equal(decisionGuideClip([clip('a', 'participant'), clip('t01_decision_prompt', 'decision_guide')])?.clip_id, 't01_decision_prompt')
    assert.equal(decisionGuideClip([clip('a', 'participant')]), null)
})

test('durations format as m:ss and invalid values are blank', () => {
    assert.equal(formatDuration(19.74), '0:20')
    assert.equal(formatDuration(3.251), '0:03')
    assert.equal(formatDuration(65), '1:05')
    assert.equal(formatDuration(0), '0:00')
    assert.equal(formatDuration(null), '')
    assert.equal(formatDuration(Number.NaN), '')
    assert.equal(formatDuration(-2), '')
})

test('progress is clamped and safe before metadata loads', () => {
    assert.equal(progressFraction(5, 10), 0.5)
    assert.equal(progressFraction(12, 10), 1)
    assert.equal(progressFraction(3, 0), 0)
    assert.equal(progressFraction(3, Number.NaN), 0)
})

test('each adviser offers three suggested questions, led by the guide question', () => {
    for (const questions of Object.values(SUGGESTED_QUESTIONS)) assert.equal(questions.length, 3)
    assert.equal(SUGGESTED_QUESTIONS.it[0], 'What must be verified before we promise a restoration time?')
})

test('adviser initials, asker names and reply sources are friendly', () => {
    assert.equal(adviserInitials('IT adviser'), 'IA')
    assert.equal(adviserInitials('Facilitator'), 'FA')
    assert.equal(adviserInitials('  '), '?')
    const members = [{ member_id: 'm2', display_name: 'Priya' }] as RoomMember[]
    assert.equal(askerName(members, 'm1', 'm1'), 'You')
    assert.equal(askerName(members, 'm2', 'm1'), 'Priya')
    assert.equal(askerName(members, 'gone', 'm1'), 'A former participant')
    assert.equal(replySourceLabel('offline'), 'Offline reply')
    assert.equal(replySourceLabel('hosted'), 'AI reply')
    assert.equal(replySourceLabel(null), '')
})

test('consultations are shown newest first and merging never duplicates or regresses', () => {
    const older = consultation({ consultation_id: 'a', at: '2026-01-01T10:00:00Z' })
    const newer = consultation({ consultation_id: 'b', at: '2026-01-01T10:05:00Z' })
    assert.deepEqual(orderConsultations([older, newer]).map((item) => item.consultation_id), ['b', 'a'])
    const pending = consultation({ consultation_id: 'c', status: 'pending', reply: null })
    assert.equal(mergeConsultation([older], pending).length, 2)
    const ready = consultation({ consultation_id: 'c', status: 'ready' })
    assert.equal(mergeConsultation([ready], pending)[0].status, 'ready')
})

test('asking is blocked outside the meeting and while your own question is pending', () => {
    const list = [consultation({ consultation_id: 'p', member_id: 'me', status: 'pending', reply: null })]
    assert.equal(hasOwnPending(list, 'me'), true)
    assert.equal(hasOwnPending(list, 'other'), false)
    assert.equal(askAvailability('discussion', false, false).blocked, false)
    assert.equal(askAvailability('ended', false, false).blocked, true)
    assert.equal(askAvailability('lobby', false, false).blocked, true)
    assert.equal(askAvailability('voting', true, false).blocked, true)
    assert.equal(askAvailability('voting', false, true).blocked, true)
})
