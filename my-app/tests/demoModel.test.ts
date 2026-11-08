import assert from 'node:assert/strict'
import test from 'node:test'
import { demoRoles, demoRoomCode, followTarget, pickDemoScenario, readStoredDemo, seatStatus } from '../src/features/demo/demoModel.ts'
import type { RoomGame, RoomSnapshot, Scenario } from '../src/services/rooms.ts'

const scenario: Scenario = {
    scenario_id: 'fixture', version: 3, title: 'Fixture', content_sha256: 'digest',
    roles: [{ role_id: 'ceo', name: 'CEO' }, { role_id: 'security', name: 'Security' }, { role_id: 'finance', name: 'Finance' }],
    timings: [{ profile_id: 'standard_18', briefing_seconds: 180 }],
}
const roles: Record<string, string> = { a: 'ceo', b: 'security', c: 'finance' }

function room(self: string, phase: RoomSnapshot['phase'], game: Partial<RoomGame> = {}): RoomSnapshot {
    const base = {
        room_id: 'room', room_code: 'ABC123', room_version: 3, capacity: 30 as const, presence_window_seconds: 30 as const,
        host_member_id: 'a', self_member_id: self,
        members: ['a', 'b', 'c'].map((id) => ({ member_id: id, display_name: id, is_host: id === 'a', connected: true, role_id: phase === 'lobby' ? null : roles[id], eligible_from_round: 1, eligible_current_round: true })),
    }
    if (phase === 'lobby') return { ...base, phase, game: null }
    return { ...base, phase, game: {
        phase_id: 'p1', round_id: 'r1', round_number: 1, started_at: '', scenario, timing_profile: 'standard_18', briefing_seconds: 180, result_seconds: 30,
        initial_node_id: 'n', facts: {}, public_documents: [], eligible_member_ids: ['a', 'b', 'c'], ending_label: null, ...game,
    } }
}

test('demo room codes are six valid characters and stored demos are validated', () => {
    assert.match(demoRoomCode(), /^[A-Z0-9]{6}$/)
    assert.equal(demoRoomCode(() => new Uint8Array([0, 1, 2, 3, 4, 5])), 'ABCDEF')
    const id = '9d716cd1-a7c8-4e73-a8ac-a05634972559'
    assert.deepEqual(readStoredDemo(JSON.stringify({ room_id: id, room_code: 'K7MPQ2' })), { room_id: id, room_code: 'K7MPQ2' })
    for (const raw of [null, '', '{', '[]', JSON.stringify({ room_id: 'x', room_code: 'K7MPQ2' }), JSON.stringify({ room_id: id, room_code: 'bad' })]) assert.equal(readStoredDemo(raw), null)
})

test('the demo prefers the T01 Cedar Bridge scenario, else the first listed', () => {
    const t01 = { ...scenario, scenario_id: 'cedar_bridge_t01' }
    assert.equal(pickDemoScenario([scenario, t01]), t01)
    assert.equal(pickDemoScenario([scenario]), scenario)
    assert.equal(pickDemoScenario([]), undefined)
})

test('Alex becomes CEO, Morgan takes recovery or IT and Sam communications', () => {
    const maplecart = { ...scenario, roles: [{ role_id: 'ceo', name: 'CEO' }, { role_id: 'security', name: 'Security lead' }, { role_id: 'technology', name: 'Technology lead' }, { role_id: 'finance', name: 'Finance lead' }, { role_id: 'communications_privacy', name: 'Communications and privacy lead' }] }
    assert.deepEqual(demoRoles(room('a', 'lobby'), ['a', 'b', 'c'], maplecart), { a: 'ceo', b: 'technology', c: 'communications_privacy' })
    const t01 = { ...scenario, roles: [{ role_id: 'ceo', name: 'Interim lead' }, { role_id: 'comms', name: 'Communications officer' }, { role_id: 'it_recovery', name: 'IT recovery' }] }
    assert.deepEqual(demoRoles(room('a', 'lobby'), ['a', 'b', 'c'], t01), { a: 'ceo', b: 'it_recovery', c: 'comms' })
    // Without matching roles, Morgan and Sam take distinct roles in scenario order.
    assert.deepEqual(demoRoles(room('a', 'lobby'), ['a', 'b', 'c'], scenario), { a: 'ceo', b: 'security', c: 'finance' })
    assert.throws(() => demoRoles(room('a', 'lobby'), ['a', 'b', 'c'], { ...scenario, roles: [{ role_id: 'security', name: 'Security' }] }), /CEO/)
})

test('seat indicators report speaking, deciding, voted and CEO tie states', () => {
    assert.deepEqual(seatStatus(null), { phase: null, roleId: null, speaking: false, decide: false, voted: false, ceoTie: false })
    assert.equal(seatStatus(room('b', 'speaking', { active_speaker_id: 'b' })).speaking, true)
    assert.equal(seatStatus(room('a', 'speaking', { active_speaker_id: 'b' })).speaking, false)
    assert.equal(seatStatus(room('a', 'voting', { allowed_actions: ['vote'], self_vote: null })).decide, true)
    assert.deepEqual([seatStatus(room('a', 'voting', { allowed_actions: ['vote'], self_vote: 'opt' }))].map((status) => [status.decide, status.voted]), [[false, true]])
    assert.equal(seatStatus(room('a', 'voting', { allowed_actions: [], self_vote: null })).decide, false)
    assert.equal(seatStatus(room('a', 'tie_break')).ceoTie, true)
    assert.equal(seatStatus(room('b', 'tie_break')).ceoTie, false)
})

test('auto follow picks the speaker, the next voter in seat order, then the CEO', () => {
    const seats = ['a', 'b', 'c']
    assert.equal(followTarget(seats.map((id) => room(id, 'speaking', { active_speaker_id: 'c' }))), 2)
    const votes: Record<string, string | null> = { a: 'x', b: null, c: null }
    assert.equal(followTarget(seats.map((id) => room(id, 'voting', { allowed_actions: ['vote'], self_vote: votes[id] }))), 1)
    assert.equal(followTarget(seats.map((id) => room(id, 'voting', { allowed_actions: ['vote'], self_vote: 'x' }))), 0)
    assert.equal(followTarget(seats.map((id) => room(id, 'tie_break'))), 0)
    assert.equal(followTarget(seats.map((id) => room(id, 'discussion'))), null)
    assert.equal(followTarget([null, null, null]), null)
})
