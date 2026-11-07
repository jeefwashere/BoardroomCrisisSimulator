import assert from 'node:assert/strict'
import test from 'node:test'
import { createTabSession, TAB_ID_KEY, TAB_TOKEN_KEY } from '../src/services/tabSession.ts'
import { createRoomApi } from '../src/services/rooms.ts'

function store(seed: Record<string, string> = {}) {
    const data = new Map(Object.entries(seed))
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, copy: () => Object.fromEntries(data) }
}

test('one page coalesces initialization and resumes its stored credential after refresh', async () => {
    const storage = store()
    const session = createTabSession({ storage, randomId: () => 'tab-a', claim: async () => true })
    let calls = 0
    const establish = async (previous: string | null) => { calls++; assert.equal(previous, null); return 'credential-a' }
    assert.deepEqual(await Promise.all([session.token(establish), session.token(establish)]), ['credential-a', 'credential-a'])
    assert.equal(calls, 1)
    const refreshed = createTabSession({ storage, claim: async () => true })
    assert.equal(await refreshed.token(async (previous) => { assert.equal(previous, 'credential-a'); return previous! }), 'credential-a')
})

test('an opener copied tab forks both its public coordination ID and its credential', async () => {
    const storage = store({ [TAB_ID_KEY]: 'original-tab', [TAB_TOKEN_KEY]: 'original-credential' })
    const claims: string[] = []
    const session = createTabSession({ storage, randomId: () => 'forked-tab', claim: async (id) => { claims.push(id); return id !== 'original-tab' } })
    await session.token(async (previous) => { assert.equal(previous, null); return 'forked-credential' })
    assert.deepEqual(claims, ['original-tab', 'forked-tab'])
    assert.equal(storage.getItem(TAB_ID_KEY), 'forked-tab')
    assert.equal(storage.getItem(TAB_TOKEN_KEY), 'forked-credential')
})

test('three ordinary tabs use independent storage and independently bootstrap', async () => {
    const sessions = [0, 1, 2].map((index) => createTabSession({ storage: store(), randomId: () => `tab-${index}` }))
    const tokens = await Promise.all(sessions.map((session, index) => session.token(async (previous) => { assert.equal(previous, null); return `credential-${index}` })))
    assert.equal(new Set(tokens).size, 3)
})

test('blocked storage still permits a coalesced in memory visit', async () => {
    const storage = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') }, removeItem: () => { throw Error('blocked') } }
    const session = createTabSession({ storage, randomId: () => 'memory-tab' })
    assert.equal(await session.token(async () => 'memory-credential'), 'memory-credential')
    assert.equal(await session.token(async () => { throw Error('must not reinitialize') }), 'memory-credential')
})

test('failed bootstrap permits an explicit retry with the same resume credential', async () => {
    const storage = store({ [TAB_ID_KEY]: 'existing-tab', [TAB_TOKEN_KEY]: 'existing-credential' })
    const session = createTabSession({ storage, claim: async () => true })
    await assert.rejects(session.token(async () => { throw Error('offline') }), /offline/)
    assert.equal(await session.token(async (previous) => { assert.equal(previous, 'existing-credential'); return previous! }), 'existing-credential')
})

test('RoomApi bootstraps once before concurrent callers without a cookie session request', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const session = createTabSession({ storage: store({ [TAB_ID_KEY]: 'tab', [TAB_TOKEN_KEY]: 'resume-token' }), claim: async () => true })
    const api = createRoomApi({ baseUrl: '', session, fetch: async (path, init) => {
        calls.push({ path: String(path), init })
        assert.equal(String(path), '/api/tab-sessions')
        assert.deepEqual(JSON.parse(String(init?.body)), { session_token: 'resume-token' })
        assert.equal(new Headers(init?.headers).has('X-Boardroom-Session'), false)
        return new Response(JSON.stringify({ status: 'ready', session_token: 'resumed-token' }))
    } })
    await Promise.all([api.initializeSession(), api.initializeSession()])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init?.method, 'POST')
})
