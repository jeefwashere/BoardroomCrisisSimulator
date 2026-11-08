import test from 'node:test'
import assert from 'node:assert/strict'
import {
    EXPERT_STATUS_LABELS, activeExpertIndex, expertCardStatus, expertPersona, normalizeExperts, panelForRound,
    panelSettled, panelSourceLabel, showsExpertStage,
} from '../src/features/game/expertPanelModel.ts'
import type { ExpertPanel, ExpertTake } from '../src/services/facilitation.ts'

function take(kind: ExpertTake['kind'], fields: Partial<ExpertTake> = {}): ExpertTake {
    return { kind, label: kind, status: 'ready', text: `${kind} take`, source: 'vertex', speech_id: `speech-${kind}`, error: null, ...fields }
}

function panel(experts: ExpertTake[], fields: Partial<ExpertPanel> = {}): ExpertPanel {
    return { round_id: 'r1', status: 'ready', experts, ...fields }
}

test('the expert stage shows only during an experts mode discussion', () => {
    assert.equal(showsExpertStage('discussion', 'experts'), true)
    assert.equal(showsExpertStage('discussion', 'open'), false)
    assert.equal(showsExpertStage('discussion', undefined), false)
    assert.equal(showsExpertStage('voting', 'experts'), false)
})

test('experts are normalized to the fixed order with placeholders for missing takes', () => {
    const experts = normalizeExperts(panel([take('journalist'), take('facilitator')]))
    assert.deepEqual(experts.map((item) => item.kind), ['facilitator', 'it', 'journalist'])
    assert.equal(experts[1].status, 'pending')
    assert.equal(experts[1].label, 'IT adviser')
    assert.deepEqual(normalizeExperts(null).map((item) => item.status), ['pending', 'pending', 'pending'])
})

test('a panel from another round is ignored', () => {
    const current = panel([])
    assert.equal(panelForRound(current, 'r1'), current)
    assert.equal(panelForRound(current, 'r2'), null)
    assert.equal(panelForRound(undefined, 'r1'), null)
    assert.equal(panelForRound(panel([], { round_id: '' }), 'r9')?.round_id, '')
})

test('polling settles only when the panel is ready and no take is pending', () => {
    assert.equal(panelSettled(null), false)
    assert.equal(panelSettled(panel([take('facilitator')], { status: 'pending' })), false)
    assert.equal(panelSettled(panel([take('facilitator'), take('it', { status: 'pending' })])), false)
    assert.equal(panelSettled(panel([take('facilitator'), take('it', { status: 'failed' })])), true)
})

test('the active expert follows the step, skips failed takes and ends at -1', () => {
    const experts = normalizeExperts(panel([take('facilitator'), take('it', { status: 'failed' }), take('journalist')]))
    assert.equal(activeExpertIndex(experts, 0), 0)
    assert.equal(activeExpertIndex(experts, 1), 2)
    assert.equal(activeExpertIndex(experts, 3), -1)
    assert.equal(activeExpertIndex(normalizeExperts(panel([take('facilitator', { status: 'failed' }), take('it', { status: 'failed' }), take('journalist', { status: 'failed' })])), 0), -1)
})

test('a pending take holds the floor until it is ready', () => {
    const experts = normalizeExperts(panel([take('facilitator'), take('it', { status: 'pending' }), take('journalist')], { status: 'pending' }))
    assert.equal(activeExpertIndex(experts, 1), 1)
    assert.equal(expertCardStatus(experts, 1, 1), 'preparing')
})

test('card statuses read Done, Speaking, Up next and Preparing', () => {
    const experts = normalizeExperts(panel([take('facilitator'), take('it'), take('journalist', { status: 'pending' })], { status: 'pending' }))
    assert.deepEqual([0, 1, 2].map((index) => expertCardStatus(experts, index, 1)), ['done', 'speaking', 'preparing'])
    assert.deepEqual([0, 1, 2].map((index) => expertCardStatus(experts, index, 0)), ['speaking', 'up_next', 'preparing'])
    const finished = normalizeExperts(panel([take('facilitator'), take('it', { status: 'failed' }), take('journalist')]))
    assert.deepEqual([0, 1, 2].map((index) => expertCardStatus(finished, index, -1)), ['done', 'unavailable', 'done'])
    assert.equal(EXPERT_STATUS_LABELS.preparing, 'Preparing…')
    assert.equal(EXPERT_STATUS_LABELS.up_next, 'Up next')
})

test('personas come from the advisers list with a built in fallback', () => {
    assert.equal(expertPersona('it', [{ kind: 'it', label: 'IT adviser', description: 'Recovery character.' }]), 'Recovery character.')
    assert.match(expertPersona('journalist'), /publicly/)
})

test('the source label reflects live and offline takes', () => {
    assert.equal(panelSourceLabel(normalizeExperts(panel([take('facilitator'), take('it')]))), 'Live Gemini (Vertex AI) · voiced by ElevenLabs')
    assert.equal(panelSourceLabel(normalizeExperts(panel([take('facilitator', { source: 'offline' })]))), 'Offline reply')
    assert.match(panelSourceLabel(normalizeExperts(panel([take('facilitator'), take('it', { source: 'offline' })]))), /some replies offline/)
    assert.equal(panelSourceLabel(normalizeExperts(null)), '')
})
