import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomApi, RoomApiError } from '../src/services/rooms.ts'
import type { Contribution, ContributionInput } from '../src/services/rooms.ts'

const entry: Contribution = {
    contribution_id: 'entry-1', sequence: 1, member_id: 'member-1', role_id: null,
    phase_id: null, phase: 'lobby', round_id: null, round_number: null, node_id: null,
    kind: 'chat', source: 'typed', text: '  Keep the original text.\nSecond line.  ', at: '2026-11-08T00:45:00Z',
}
const input: ContributionInput = Object.freeze({
    command_id: 'caller-intent', phase_id: null, kind: 'chat', source: 'typed', text: entry.text,
})

function json(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

function apiWith(fetch: typeof globalThis.fetch) {
    return createRoomApi({ baseUrl: 'http://local.test:8000/', session: { token: async () => 'private-tab-token' }, fetch })
}

test('contribution routes use the selected private tab, exact input and cancellation', async () => {
    const signal = new AbortController().signal
    const calls: RequestInit[] = []
    const api = apiWith(async (url, init) => {
        assert.equal(String(url), 'http://local.test:8000/api/rooms/room%2F1/contributions')
        assert.equal(init?.credentials, 'include')
        assert.equal(init?.signal, signal)
        assert.equal(new Headers(init?.headers).get('X-Boardroom-Session'), 'private-tab-token')
        calls.push(init!)
        return json(init?.method === 'POST' ? entry : [entry], init?.method === 'POST' ? 201 : 200)
    })
    assert.deepEqual(await api.contributions('room/1', signal), [entry])
    assert.deepEqual(await api.contribute('room/1', input, signal), entry)
    assert.equal(calls[0].method, 'GET')
    assert.equal(calls[0].body, undefined)
    assert.equal(new Headers(calls[0].headers).get('Content-Type'), null)
    assert.equal(calls[1].method, 'POST')
    assert.equal(new Headers(calls[1].headers).get('Content-Type'), 'application/json')
    assert.deepEqual(JSON.parse(String(calls[1].body)), input)
    assert.deepEqual(Object.keys(JSON.parse(String(calls[1].body))), ['command_id', 'phase_id', 'kind', 'source', 'text'])
    assert.equal(input.text, entry.text)
})

test('GET preserves the complete ordered server record including unselected answers and reviewed text', async () => {
    const records: Contribution[] = Array.from({ length: 137 }, (_, index) => ({
        ...entry, contribution_id: `entry-${index + 1}`, sequence: index + 1,
        member_id: `member-${index % 4}`, phase_id: `phase-${index % 3}`, phase: 'decision',
        role_id: 'finance', round_id: 'round-1', round_number: 1, node_id: 'incident',
        kind: index % 2 ? 'answer' : 'chat', source: index % 3 ? 'typed' : 'speech',
        text: index % 2 ? `Unselected answer ${index}` : `Observer chat ${index}`,
    }))
    const api = apiWith(async () => json(records))
    const received = await api.contributions('room-1')
    assert.deepEqual(received, records)
    assert.equal(received.length, 137)
    assert.equal(received[0].sequence, 1)
    assert.equal(received.at(-1)?.sequence, 137)
    assert.deepEqual(await apiWith(async () => json([])).contributions('room-1'), [])
})

test('recording history uses its authenticated read only room endpoint', async () => {
    const audio = { recording_id: 'rec-1', member_id: 'member-2', round_id: 'round-1', round_number: 1, phase_id: 'phase-1', status: 'review_required', transcript: 'Spoken words', reviewed_text: null, error: null, mime_type: 'audio/webm', audio_available: true, started_at: '2026-11-08T00:45:00Z', duration_seconds: 7, ended_at: '2026-11-08T00:45:07Z' }
    const api = apiWith(async (url, init) => {
        assert.equal(String(url), 'http://local.test:8000/api/rooms/room-1/recordings')
        assert.equal(init?.method, 'GET')
        assert.equal(new Headers(init?.headers).get('X-Boardroom-Session'), 'private-tab-token')
        return json([audio])
    })
    assert.deepEqual(await api.recordings('room-1'), [audio])
})

test('server attribution is returned unchanged rather than inferred from the caller or current roster', async () => {
    const committed: Contribution = { ...entry, member_id: 'authenticated-member', role_id: 'security',
        phase_id: 'original-phase', phase: 'result', round_id: 'original-round', round_number: 2, node_id: 'recovery' }
    const api = apiWith(async () => json(committed, 201))
    assert.deepEqual(await api.contribute('room-1', input), committed)
})

test('new stale requests expose their domain error without changing the input or retrying', async () => {
    let calls = 0
    const api = apiWith(async () => { calls += 1; return json({ detail: { code: 'stale_phase', message: 'Refresh the room before submitting' } }, 409) })
    await assert.rejects(api.contribute('room-1', input), (error: unknown) => {
        assert.ok(error instanceof RoomApiError)
        assert.equal(error.code, 'stale_phase')
        assert.equal(error.status, 409)
        return true
    })
    assert.equal(calls, 1)
    assert.equal(input.command_id, 'caller-intent')
    assert.equal(input.phase_id, null)
    assert.equal(input.text, entry.text)
})

test('uncertain POST sends once and an explicit retry reuses the entire original intent after phase change', async () => {
    const original: ContributionInput = Object.freeze({ ...input, phase_id: 'phase-before-change' })
    const committed: Contribution = { ...entry, phase_id: original.phase_id, phase: 'briefing' }
    const bodies: string[] = []
    const api = apiWith(async (_url, init) => {
        bodies.push(String(init?.body))
        if (bodies.length === 1) throw new TypeError('Disconnected after server acceptance')
        return json(committed, 201)
    })
    await assert.rejects(api.contribute('room-1', original), (error: unknown) => error instanceof RoomApiError && error.code === 'network_error')
    assert.equal(bodies.length, 1)
    assert.deepEqual(await api.contribute('room-1', original), committed)
    assert.equal(bodies[0], bodies[1])
    assert.deepEqual(JSON.parse(bodies[1]), original)
})

test('both reads and writes retain permission and ended errors', async () => {
    for (const [status, code] of [[401, 'invalid_session'], [403, 'not_a_member'], [409, 'game_ended']] as const) {
        const api = apiWith(async () => json({ detail: { code, message: 'Request rejected' } }, status))
        for (const operation of [() => api.contributions('room-1'), () => api.contribute('room-1', input)]) {
            await assert.rejects(operation(), (error: unknown) => error instanceof RoomApiError && error.code === code && error.status === status)
        }
    }
})

test('malformed records reject the whole response instead of silently losing historical entries', async () => {
    const invalid: unknown[] = [null, { ...entry, source: 'microphone' }, { ...entry, kind: 'vote' },
        { ...entry, sequence: 0 }, { ...entry, sequence: 1.5 }, { ...entry, round_number: '1' },
        { ...entry, role_id: undefined }, { ...entry, phase_id: undefined }, { ...entry, node_id: undefined },
        { ...entry, round_id: 12 }, { ...entry, member_id: null }, { ...entry, text: 42 }, { ...entry, at: null }]
    for (const value of invalid) {
        const api = apiWith(async (_url, init) => json(init?.method === 'POST' ? value : [entry, value]))
        for (const operation of [() => api.contributions('room-1'), () => api.contribute('room-1', input)]) {
            await assert.rejects(operation(), (error: unknown) => error instanceof RoomApiError && error.code === 'invalid_response')
        }
    }
    await assert.rejects(apiWith(async () => json({ contributions: [entry] })).contributions('room-1'),
        (error: unknown) => error instanceof RoomApiError && error.code === 'invalid_response')
})

test('abort preserves cancellation for both endpoints, including response parsing', async () => {
    for (const parsing of [false, true]) {
        for (const write of [false, true]) {
            const controller = new AbortController()
            const cancellation = new DOMException('Cancelled', 'AbortError')
            const api = apiWith(async (_url, init) => {
                assert.equal(init?.signal, controller.signal)
                if (!parsing) { controller.abort(); throw cancellation }
                const response = json(write ? entry : [entry])
                response.json = async () => { throw cancellation }
                return response
            })
            await assert.rejects(write ? api.contribute('room-1', input, controller.signal)
                : api.contributions('room-1', controller.signal), (error: unknown) => error === cancellation)
        }
    }
})

test('malformed JSON and validation responses retain safe actionable errors', async () => {
    await assert.rejects(apiWith(async () => new Response('not JSON')).contributions('room-1'),
        (error: unknown) => error instanceof RoomApiError && error.code === 'invalid_response')
    const api = apiWith(async () => json({ detail: [{ loc: ['body', 'text'], msg: 'Too long', type: 'string_too_long', input: 'private content' }] }, 422))
    await assert.rejects(api.contribute('room-1', input), (error: unknown) => {
        assert.ok(error instanceof RoomApiError)
        assert.equal(error.status, 422)
        assert.deepEqual(error.details, [{ loc: ['body', 'text'], msg: 'Too long', type: 'string_too_long' }])
        assert.doesNotMatch(JSON.stringify(error), /private content/)
        return true
    })
})
