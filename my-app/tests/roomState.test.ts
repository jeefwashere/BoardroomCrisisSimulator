import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptSnapshot, pollRoom, roomMembers, startInput, startProblem } from '../src/features/rooms/roomState.ts'
import type { RoomSnapshot, Scenario } from '../src/services/rooms.ts'

const scenario: Scenario = {
    scenario_id: 'fixture', version: 3, title: 'Fixture', content_sha256: 'digest',
    roles: [{ role_id: 'ceo', name: 'CEO' }, { role_id: 'security', name: 'Security' }],
    timings: [{ profile_id: 'standard_18', briefing_seconds: 180 }],
}
function lobby(): RoomSnapshot {
    return {
        room_id: 'room', room_code: 'ABC123', room_version: 3, capacity: 10, presence_window_seconds: 30,
        phase: 'lobby', game: null, host_member_id: 'a', self_member_id: 'a',
        members: ['a', 'b', 'c'].map((id) => ({ member_id: id, display_name: `Server ${id}`, is_host: id === 'a', connected: true, role_id: null, eligible_from_round: null, eligible_current_round: false })),
    }
}
const roles = { a: 'security', b: 'ceo', c: 'security' }

test('a historical command receipt never rolls a newer room back, while equal version updates presence', () => {
    const current = lobby()
    assert.equal(acceptSnapshot(current, { ...current, room_version: 2 }), current)
    const fresh = { ...current, members: current.members.map((member) => ({ ...member, connected: false })) }
    assert.equal(acceptSnapshot(current, fresh), fresh)
    assert.equal(acceptSnapshot(current, { ...current, room_id: 'different' }), current)
    assert.equal(acceptSnapshot(null, current), current)
})

test('Start sends every actual server member ID, and the CEO need not be host', () => {
    assert.equal(startProblem(lobby(), scenario, roles), null)
    assert.deepEqual(startInput(lobby(), scenario, 'standard_18', roles, 'command').players, [
        { member_id: 'a', role_id: 'security' }, { member_id: 'b', role_id: 'ceo' }, { member_id: 'c', role_id: 'security' },
    ])
})

test('Start guards missing roles, inactive count, invalid role, CEO count, and nonhost caller', () => {
    const room = lobby()
    assert.match(startProblem(room, scenario, { a: 'ceo', b: 'security' })!, /every participant/)
    assert.match(startProblem(room, scenario, { ...roles, c: 'finance' })!, /scenario role/)
    assert.match(startProblem(room, scenario, { ...roles, a: 'ceo' })!, /exactly one CEO/)
    assert.match(startProblem({ ...room, self_member_id: 'b' }, scenario, roles)!, /Only the host/)
    assert.match(startProblem({ ...room, members: room.members.map((member) => ({ ...member, connected: member.member_id !== 'b' })) }, scenario, roles)!, /3 active/)
    assert.throws(() => startInput(room, scenario, 'invented', roles, 'id'), /timing/)
})

test('a joining member invalidates the old Start draft until the host assigns the real new seat', () => {
    const room = lobby()
    room.members.push({ ...room.members[0], member_id: 'late', is_host: false })
    assert.match(startProblem(room, scenario, roles)!, /every participant/)
    const payload = startInput(room, scenario, 'standard_18', { ...roles, late: 'security', nonexistent: 'ceo' }, 'id')
    assert.deepEqual(payload.players.map((player) => player.member_id), ['a', 'b', 'c', 'late'])
})

test('adapter uses authoritative seat name, presence and eligibility, then assigned scenario role after Start', () => {
    const room = lobby()
    assert.equal(roomMembers(room, roles)[0].name, 'Server a')
    assert.equal(roomMembers(room, roles)[0].role, 'security')
    const started = { ...room, phase: 'briefing', game: {} } as RoomSnapshot
    started.members = room.members.map((member) => ({ ...member, role_id: 'security', eligible_from_round: 2, eligible_current_round: false }))
    const presented = roomMembers(started, { a: 'ceo' }, scenario)[0]
    assert.equal(presented.role, 'security')
    assert.equal(presented.roleLabel, 'Security')
    assert.equal(presented.eligibleFromRound, 2)
    assert.equal(presented.connected, true)
})

test('polling waits for completion, aborts on leave and ignores an aborted late response', async () => {
    let reads = 0
    let receives = 0
    let capturedSignal: AbortSignal | undefined
    let resolveRead: ((room: RoomSnapshot) => void) | undefined
    const stop = pollRoom((signal) => {
        reads++
        capturedSignal = signal
        return new Promise((resolve) => { resolveRead = resolve })
    }, () => receives++, () => assert.fail('unexpected failure'), 1)
    await new Promise((resolve) => setTimeout(resolve, 8))
    assert.equal(reads, 1)
    stop()
    assert.equal(capturedSignal?.aborted, true)
    resolveRead!(lobby())
    await new Promise((resolve) => setTimeout(resolve, 8))
    assert.equal(receives, 0)
    assert.equal(reads, 1)
})

test('a poll failure is visible and a later cycle can recover', async () => {
    let reads = 0
    let failures = 0
    let recover: (() => void) | undefined
    const recovered = new Promise<void>((resolve) => { recover = resolve })
    const stop = pollRoom(async () => { if (++reads === 1) throw new Error('offline'); return lobby() }, () => recover!(), () => failures++, 1)
    await recovered
    stop()
    assert.equal(failures, 1)
    assert.equal(reads, 2)
})

test('returning to a tab refreshes immediately without overlapping an outstanding poll', async () => {
    let resume: (() => void) | undefined
    let unsubscribed = false
    let reads = 0
    let finish: ((room: RoomSnapshot) => void) | undefined
    const stop = pollRoom(async () => {
        reads++
        return new Promise<RoomSnapshot>((resolve) => { finish = resolve })
    }, () => {}, () => assert.fail('unexpected failure'), 60_000, (listener) => {
        resume = listener
        return () => { unsubscribed = true }
    })
    assert.equal(reads, 1)
    resume!()
    resume!()
    assert.equal(reads, 1)
    finish!(lobby())
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(reads, 2)
    finish!(lobby())
    await new Promise((resolve) => setTimeout(resolve, 1))
    resume!()
    assert.equal(reads, 3)
    stop()
    assert.equal(unsubscribed, true)
    finish!(lobby())
})
