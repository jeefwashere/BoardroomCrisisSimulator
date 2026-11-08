import assert from 'node:assert/strict'
import test from 'node:test'
import { browserTabSession, clearSeatSession, createTabSession, seatFromSearch, seatStorage, TAB_ID_KEY, TAB_TOKEN_KEY, validSeat } from '../src/services/tabSession.ts'

function store(seed: Record<string, string> = {}) {
    const data = new Map(Object.entries(seed))
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, copy: () => Object.fromEntries(data) }
}

test('seat names accept 1 to 16 lowercase letters or digits only', () => {
    assert.equal(validSeat('alex'), 'alex')
    assert.equal(validSeat('seat2'), 'seat2')
    assert.equal(validSeat('a'.repeat(16)), 'a'.repeat(16))
    for (const invalid of ['', 'Alex', 'a'.repeat(17), 'al ex', 'al.ex', 'al-ex', null, undefined]) assert.equal(validSeat(invalid), null)
    assert.equal(seatFromSearch('?seat=morgan'), 'morgan')
    assert.equal(seatFromSearch('?other=1&seat=sam'), 'sam')
    assert.equal(seatFromSearch(''), null)
    assert.equal(seatFromSearch('?seat=..%2Fx'), null)
    assert.throws(() => seatStorage(store(), 'Bad Seat'), /lowercase/)
})

test('seat storage suffixes keys and keeps seats independent of the default tab', async () => {
    const shared = store({ [TAB_ID_KEY]: 'default-tab', [TAB_TOKEN_KEY]: 'default-credential' })
    const sessions = ['alex', 'morgan', 'sam'].map((seat) => createTabSession({ storage: seatStorage(shared, seat), randomId: () => `tab-${seat}` }))
    const tokens = await Promise.all(sessions.map((session, index) => session.token(async (previous) => { assert.equal(previous, null); return `credential-${index}` })))
    assert.deepEqual(tokens, ['credential-0', 'credential-1', 'credential-2'])
    assert.deepEqual(shared.copy(), {
        [TAB_ID_KEY]: 'default-tab', [TAB_TOKEN_KEY]: 'default-credential',
        [`${TAB_ID_KEY}.alex`]: 'tab-alex', [`${TAB_TOKEN_KEY}.alex`]: 'credential-0',
        [`${TAB_ID_KEY}.morgan`]: 'tab-morgan', [`${TAB_TOKEN_KEY}.morgan`]: 'credential-1',
        [`${TAB_ID_KEY}.sam`]: 'tab-sam', [`${TAB_TOKEN_KEY}.sam`]: 'credential-2',
    })
})

test('a seated frame resumes the credential its demo parent stored', async () => {
    const shared = store()
    await createTabSession({ storage: seatStorage(shared, 'alex'), randomId: () => 'tab-alex' }).token(async () => 'credential-alex')
    const frame = createTabSession({ storage: seatStorage(shared, 'alex'), claim: async (id) => id === 'tab-alex' })
    assert.equal(await frame.token(async (previous) => { assert.equal(previous, 'credential-alex'); return previous! }), 'credential-alex')
})

test('clearing one seat leaves the other seats and the default tab untouched', () => {
    const shared = store({ [TAB_ID_KEY]: 'default', [`${TAB_ID_KEY}.alex`]: 'a', [`${TAB_TOKEN_KEY}.alex`]: 'ta', [`${TAB_ID_KEY}.sam`]: 's' })
    clearSeatSession(shared, 'alex')
    assert.deepEqual(shared.copy(), { [TAB_ID_KEY]: 'default', [`${TAB_ID_KEY}.sam`]: 's' })
})

test('browserTabSession uses seat keys when the page URL names a seat', async () => {
    const storage = store()
    const listeners = new Map<string, () => void>()
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: storage, location: { search: '?seat=alex' }, addEventListener: (name: string, listener: () => void) => { listeners.set(name, listener) } } })
    try {
        const token = await browserTabSession().token(async (previous) => { assert.equal(previous, null); return 'seat-credential' })
        assert.equal(token, 'seat-credential')
        assert.equal(storage.getItem(`${TAB_TOKEN_KEY}.alex`), 'seat-credential')
        assert.ok(storage.getItem(`${TAB_ID_KEY}.alex`))
        assert.equal(storage.getItem(TAB_TOKEN_KEY), null)
        assert.equal(storage.getItem(TAB_ID_KEY), null)
    } finally {
        listeners.get('pagehide')?.()
        if (original) Object.defineProperty(globalThis, 'window', original)
        else delete (globalThis as { window?: unknown }).window
    }
})
