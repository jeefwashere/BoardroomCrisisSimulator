import test from 'node:test'
import assert from 'node:assert/strict'
import { clearDemoSession, createDemoEnder, DEMO_EXIT_MESSAGE, isDemoExitRequest, leaveDemoImmediately } from '../src/features/demo/demoExit.ts'
import { RoomApiError } from '../src/services/rooms.ts'
import type { RoomGame, RoomSnapshot } from '../src/services/rooms.ts'
import { DEMO_STORAGE_KEY } from '../src/features/demo/demoModel.ts'

function view(phase: 'lobby' | 'briefing' | 'ended', phaseId = 'phase-1'): RoomSnapshot {
    const common = { room_id: 'demo-room', room_code: 'DEMO01', room_version: 3, host_member_id: 'host', self_member_id: 'host', members: [], capacity: 30 as const, presence_window_seconds: 30 as const }
    return phase === 'lobby' ? { ...common, phase, game: null } : { ...common, phase, game: { phase_id: phaseId } as RoomGame }
}

test('every demo seat may request a unified exit, only through its own same-origin frame', () => {
    const frames = ['alex', 'morgan', 'sam'].map(seat => ({ seat, source: {} }))
    for (const frame of frames) {
        const event = { origin: 'http://local.test', source: frame.source, data: { type: DEMO_EXIT_MESSAGE, seat: frame.seat, roomId: 'demo-room' } }
        assert.equal(isDemoExitRequest(event, event.origin, 'demo-room', frames), true)
        assert.equal(isDemoExitRequest({ ...event, source: {} }, event.origin, 'demo-room', frames), false)
        assert.equal(isDemoExitRequest({ ...event, origin: 'http://other.test' }, event.origin, 'demo-room', frames), false)
        assert.equal(isDemoExitRequest({ ...event, data: { ...event.data, seat: 'forged' } }, event.origin, 'demo-room', frames), false)
        assert.equal(isDemoExitRequest(event, event.origin, 'other-room', frames), false)
    }
})

test('a running demo closes through its real host leave command', async () => {
    const calls: object[] = []
    const finish = createDemoEnder({ snapshot: async () => view('briefing'), leave: async (roomId, input) => {
        calls.push({ roomId, input }); return { room_id: roomId, room_version: 4, status: 'closed' }
    } }, 'demo-room', () => 'close-command')
    await finish()
    assert.deepEqual(calls, [{ roomId: 'demo-room', input: { command_id: 'close-command' } }])
})

test('a lobby demo closes through host departure', async () => {
    const calls: object[] = []
    const finish = createDemoEnder({ snapshot: async () => view('lobby'), leave: async (roomId, input) => {
        calls.push({ roomId, input }); return { room_id: roomId, room_version: 4, status: 'closed' }
    } }, 'demo-room', () => 'leave-command')
    await finish()
    assert.deepEqual(calls, [{ roomId: 'demo-room', input: { command_id: 'leave-command' } }])
})

test('an uncertain close retry retains its exact command ID and body', async () => {
    const bodies: object[] = []
    let generated = 0
    const finish = createDemoEnder({ snapshot: async () => view('briefing'), leave: async (roomId, input) => {
        bodies.push(input)
        if (bodies.length === 1) throw new RoomApiError('Connection lost', 'network_error', null)
        return { room_id: roomId, room_version: 4, status: 'closed' }
    } }, 'demo-room', () => `id-${++generated}`)
    await assert.rejects(finish(), /Connection lost/)
    await finish()
    assert.equal(generated, 1)
    assert.strictEqual(bodies[0], bodies[1])
})

test('phase changes between retries do not change the close intent', async () => {
    const bodies: object[] = []
    let read = 0
    const finish = createDemoEnder({ snapshot: async () => view('briefing', `phase-${++read}`), leave: async (roomId, input) => {
        bodies.push(input)
        if (bodies.length === 1) throw new RoomApiError('Lost response', 'network_error', null)
        return { room_id: roomId, room_version: 4, status: 'closed' }
    } }, 'demo-room', () => 'close-command')
    await assert.rejects(finish(), /Lost response/)
    await finish()
    assert.strictEqual(bodies[0], bodies[1])
})

test('closed or deleted rooms require no further mutations', async () => {
    for (const code of ['room_closed', 'host_disconnected', 'room_not_found']) {
        const finish = createDemoEnder({ snapshot: async () => { throw new RoomApiError('Gone', code, code === 'room_not_found' ? 404 : 410) }, leave: async () => { throw Error('Should not leave') } }, 'demo-room')
        await finish()
    }
})

test('an unrelated selected client cannot be used to close the demo', async () => {
    const finish = createDemoEnder({ snapshot: async () => ({ ...view('briefing'), self_member_id: 'guest' }), leave: async () => { throw Error('Should not leave') } }, 'demo-room')
    await assert.rejects(finish(), /host session/)
})

test('demo cleanup clears all three memberships without touching the normal menu session', () => {
    const values = new Map<string, string>([[DEMO_STORAGE_KEY, JSON.stringify({ room_id: 'demo-room' })], ['boardroom.tabSession', 'normal-token'], ['boardroom.displayName', 'Tester']])
    for (const seat of ['alex', 'morgan', 'sam']) for (const key of ['boardroom.tabId', 'boardroom.tabSession', 'boardroom.displayName']) values.set(`${key}.${seat}`, `test-${seat}`)
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    clearDemoSession(storage, 'old-room')
    assert.equal(values.size, 12)
    clearDemoSession(storage, 'demo-room')
    assert.deepEqual([...values], [['boardroom.tabSession', 'normal-token'], ['boardroom.displayName', 'Tester']])
})

test('demo exit clears credentials and returns home immediately even while server cleanup is stalled or fails', async () => {
    const order: string[] = []
    let rejectCleanup!: (error: Error) => void
    const stalled = new Promise<void>((_resolve, reject) => { rejectCleanup = reject })
    leaveDemoImmediately(() => { order.push('backend'); return stalled }, () => { order.push('discard credentials') }, () => { order.push('main menu') })
    assert.deepEqual(order, ['discard credentials', 'main menu'])
    await Promise.resolve()
    assert.deepEqual(order, ['discard credentials', 'main menu', 'backend'])
    rejectCleanup(new Error('Backend unavailable'))
    await Promise.resolve()
})

test('demo cleanup can end a game on an older backend that only supports lobby Leave', async () => {
    const commands: object[] = []
    const finish = createDemoEnder({ snapshot: async () => view('briefing'), leave: async () => { throw new RoomApiError('Already started', 'already_started', 409) }, command: async (_room, path, input) => {
        commands.push({ path, input }); return view('ended')
    } }, 'demo-room', () => 'command-id')
    await finish()
    assert.deepEqual(commands, [{ path: 'end', input: { command_id: 'command-id', phase_id: 'phase-1' } }])
})
