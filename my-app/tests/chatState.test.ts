import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomApiError } from '../src/services/rooms.ts'
import type { Contribution, ContributionInput } from '../src/services/rooms.ts'
import { chatTextProblem, createChatStore, mergeContributions } from '../src/features/rooms/chatState.ts'

const record = (sequence: number, text = `Message ${sequence}`): Contribution => ({
    contribution_id: `entry-${sequence}`, sequence, member_id: 'member-1', role_id: null,
    phase_id: null, phase: 'lobby', round_id: null, round_number: null, node_id: null,
    kind: 'chat', source: 'typed', text, at: '2026-11-08T00:00:00Z',
})
const deferred = <T>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((yes) => { resolve = yes })
    return { promise, resolve }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

test('merge keeps complete ordered history and a POST receipt against a stale GET', () => {
    const history = Array.from({ length: 250 }, (_, i) => record(i + 1))
    const withReceipt = mergeContributions(history, [record(251)])
    const staleRead = mergeContributions(withReceipt, history.slice(0, 200))
    assert.equal(staleRead.length, 251)
    assert.deepEqual(staleRead.map((entry) => entry.sequence), Array.from({ length: 251 }, (_, i) => i + 1))
    assert.equal(mergeContributions(staleRead, [record(251)]).length, 251)
})

test('validation rejects blank and over limit text and counts Unicode code points', () => {
    assert.ok(chatTextProblem(' \n\t'))
    assert.equal(chatTextProblem('😀'.repeat(4000)), null)
    assert.ok(chatTextProblem('😀'.repeat(4001)))
})

test('uncertain retry keeps exact original command and lobby phase through Start', async () => {
    const calls: ContributionInput[] = []
    let ids = 0
    const store = createChatStore({ roomId: 'room', randomId: () => `command-${++ids}`, refreshRoom: async () => {}, api: {
        contributions: async () => [],
        contribute: async (_room, input) => {
            calls.push(input)
            if (calls.length === 1) throw new RoomApiError('Connection lost', 'network_error', null)
            return record(1, input.text)
        },
    } })
    store.setDraft('  Exact text\n😀  ')
    await store.send(null)
    assert.equal(store.getSnapshot().draft, '  Exact text\n😀  ')
    await store.send('new-briefing-phase')
    assert.strictEqual(calls[0], calls[1])
    assert.equal(calls[1].phase_id, null)
    assert.equal(ids, 1)
    assert.equal(store.getSnapshot().records.length, 1)
    assert.equal(store.getSnapshot().draft, '')
})

test('edited draft is a new intent while Retry original preserves the original body', async () => {
    const calls: ContributionInput[] = []
    let ids = 0
    const store = createChatStore({ roomId: 'room', randomId: () => `id-${++ids}`, refreshRoom: async () => {}, api: {
        contributions: async () => [],
        contribute: async (_room, input) => { calls.push(input); if (calls.length === 1) throw Error('Uncertain'); return record(calls.length, input.text) },
    } })
    store.setDraft('Original')
    await store.send(null)
    store.setDraft('New draft')
    await store.retry()
    assert.strictEqual(calls[1], calls[0])
    assert.equal(store.getSnapshot().draft, 'New draft')
    await store.send('phase-2')
    assert.equal(calls[2].command_id, 'id-2')
    assert.equal(calls[2].text, 'New draft')
    assert.equal(calls[2].phase_id, 'phase-2')
})

test('stale phase refreshes once, keeps draft, and requires explicit new send', async () => {
    let refreshed = 0
    const calls: ContributionInput[] = []
    const store = createChatStore({ roomId: 'room', randomId: () => `id-${calls.length}`, refreshRoom: async () => { refreshed++ }, api: {
        contributions: async () => [],
        contribute: async (_room, input) => { calls.push(input); if (calls.length === 1) throw new RoomApiError('Stale', 'stale_phase', 409); return record(1, input.text) },
    } })
    store.setDraft('Keep this')
    await store.send(null)
    assert.equal(refreshed, 1)
    assert.equal(calls.length, 1)
    assert.equal(store.getSnapshot().draft, 'Keep this')
    assert.equal(store.getSnapshot().retry, null)
    await store.send('phase-new')
    assert.notEqual(calls[0].command_id, calls[1].command_id)
    assert.equal(calls[1].phase_id, 'phase-new')
})

test('blank and long drafts and ended rooms never issue a new POST', async () => {
    let calls = 0
    const store = createChatStore({ roomId: 'room', refreshRoom: async () => {}, api: { contributions: async () => [], contribute: async () => { calls++; return record(1) } } })
    store.setDraft(' ')
    await store.send(null)
    store.setDraft('x'.repeat(4001))
    await store.send(null)
    store.setDraft('Saved unsent text')
    await store.send('ended-phase', true)
    assert.equal(calls, 0)
    assert.equal(store.getSnapshot().draft, 'Saved unsent text')
})

test('an ended session still permits original uncertain receipt recovery without a new intent', async () => {
    const calls: ContributionInput[] = []
    const store = createChatStore({ roomId: 'room', refreshRoom: async () => {}, api: {
        contributions: async () => [],
        contribute: async (_room, input) => { calls.push(input); if (calls.length === 1) throw Error('Lost response'); return record(1) },
    } })
    store.setDraft('Before ending')
    await store.send('active-phase')
    await store.send('ended-phase', true)
    assert.equal(calls.length, 1)
    await store.retry()
    assert.strictEqual(calls[0], calls[1])
    assert.equal(store.getSnapshot().records.length, 1)
})

test('polling merges a receipt during an older read, resumes sequentially and aborts on leave', async () => {
    const read = deferred<Contribution[]>()
    let resume!: () => void
    let reads = 0
    let signal: AbortSignal | undefined
    let unsubscribed = false
    const store = createChatStore({ roomId: 'room', refreshRoom: async () => {}, api: {
        contributions: async (_room, incomingSignal) => { reads++; signal = incomingSignal; return reads === 1 ? read.promise : [record(1), record(2)] },
        contribute: async () => record(2),
    } })
    const stop = store.start((callback) => { resume = callback; return () => { unsubscribed = true } })
    store.setDraft('Message 2')
    await store.send(null)
    resume()
    assert.equal(reads, 1)
    read.resolve([record(1)])
    await tick()
    assert.deepEqual(store.getSnapshot().records.map((item) => item.sequence), [1, 2])
    assert.equal(reads, 2)
    stop()
    assert.equal(signal?.aborted, true)
    assert.equal(unsubscribed, true)
    resume()
    await tick()
    assert.equal(reads, 2)
})

test('leaving aborts an in flight POST and ignores its late response', async () => {
    const receipt = deferred<Contribution>()
    let signal: AbortSignal | undefined
    const store = createChatStore({ roomId: 'room', refreshRoom: async () => {}, api: {
        contributions: async () => [],
        contribute: async (_room, _input, incomingSignal) => { signal = incomingSignal; return receipt.promise },
    } })
    const stop = store.start()
    store.setDraft('Waiting')
    const sending = store.send(null)
    stop()
    assert.equal(signal?.aborted, true)
    receipt.resolve(record(1))
    await sending
    assert.deepEqual(store.getSnapshot().records, [])
})

test('switching participants preserves private drafts and sends through each original identity', async () => {
    const sent: { member: string; text: string }[] = []
    const stores = ['alex', 'morgan'].map((member) => createChatStore({ roomId: 'shared-room', refreshRoom: async () => {}, api: {
        contributions: async () => [],
        contribute: async (_room, input) => { sent.push({ member, text: input.text }); return { ...record(sent.length, input.text), member_id: member } },
    } }))
    let stop = stores[0].start()
    try {
        stores[0].setDraft('Alex draft')
        stop()
        stop = stores[1].start()
        assert.equal(stores[1].getSnapshot().draft, '')
        stores[1].setDraft('Morgan message')
        await stores[1].send('phase-1')
        stop()
        stop = stores[0].start()
        assert.equal(stores[0].getSnapshot().draft, 'Alex draft')
        await stores[0].send('phase-1')
        assert.deepEqual(sent, [{ member: 'morgan', text: 'Morgan message' }, { member: 'alex', text: 'Alex draft' }])
    } finally { stop() }
})

test('switching away during send retains an exact retry and its late completion cannot clear a resumed request', async () => {
    const original = deferred<Contribution>()
    const recovered = deferred<Contribution>()
    const calls: ContributionInput[] = []
    const store = createChatStore({ roomId: 'room', refreshRoom: async () => {}, api: {
        contributions: async () => [],
        contribute: async (_room, input) => { calls.push(input); return calls.length === 1 ? original.promise : recovered.promise },
    } })
    let stop = store.start()
    try {
        store.setDraft('Keep original author and phase')
        const sending = store.send('phase-original')
        stop()
        assert.equal(store.getSnapshot().sending, false)
        assert.strictEqual(store.getSnapshot().retry, calls[0])
        stop = store.start()
        const retrying = store.retry()
        original.resolve(record(1))
        await sending
        assert.equal(store.getSnapshot().sending, true)
        assert.strictEqual(calls[0], calls[1])
        assert.equal(calls[1].phase_id, 'phase-original')
        recovered.resolve(record(1, 'Keep original author and phase'))
        await retrying
        assert.equal(store.getSnapshot().sending, false)
        assert.equal(store.getSnapshot().retry, null)
        assert.equal(store.getSnapshot().records.length, 1)
    } finally { stop() }
})
