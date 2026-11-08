import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomApi as makeRoomApi, RoomApiError } from '../src/services/rooms.ts'
import { createTabSession } from '../src/services/tabSession.ts'
import type { RoomSnapshot, Scenario, StartRoomInput } from '../src/services/rooms.ts'

const createRoomApi = (options: Parameters<typeof makeRoomApi>[0] = {}) => makeRoomApi({ session: { token: async () => 'test-tab-token' }, ...options })

const lobby: RoomSnapshot = {
    room_id: 'room-1', room_code: 'ABC123', room_version: 1, capacity: 30,
    presence_window_seconds: 30, host_member_id: 'host-1', self_member_id: 'host-1',
    phase: 'lobby', game: null,
    members: [{
        member_id: 'host-1', display_name: 'Host', is_host: true, connected: true,
        role_id: null, eligible_from_round: null, eligible_current_round: false,
    }],
}
const catalog: Scenario[] = [{
    scenario_id: 'maplecart_cybersecurity', version: 3, title: 'MapleCart', content_sha256: 'digest',
    roles: [{ role_id: 'ceo', name: 'CEO' }], timings: [{ profile_id: 'standard_18', briefing_seconds: 90 }],
}]

function json(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}

test('lobby leave sends the selected private credential and exact intent, accepting removal or closure', async () => {
    const signal = new AbortController().signal
    const input = Object.freeze({ command_id: 'leave-command' })
    for (const status of ['left', 'closed'] as const) {
        const receipt = { room_id: 'room/1', room_version: 3, status }
        const api = createRoomApi({ baseUrl: '', fetch: async (path, init) => {
            assert.equal(path, '/api/rooms/room%2F1/leave')
            assert.equal(init?.method, 'POST')
            assert.equal(init?.signal, signal)
            assert.equal(init?.credentials, 'include')
            assert.deepEqual(init?.headers, { 'X-Boardroom-Session': 'test-tab-token', 'Content-Type': 'application/json' })
            assert.deepEqual(JSON.parse(String(init?.body)), input)
            return json(receipt)
        } })
        assert.deepEqual(await api.leave('room/1', input, signal), receipt)
    }
})

test('leave transport errors retain the original command for an explicit retry and never retry automatically', async () => {
    const bodies: string[] = []
    const input = Object.freeze({ command_id: 'retry-leave-command' })
    const api = createRoomApi({ fetch: async (_path, init) => {
        bodies.push(String(init?.body))
        if (bodies.length === 1) throw new TypeError('Connection lost after commit')
        return json({ room_id: 'room-1', room_version: 3, status: 'left' })
    } })
    await assert.rejects(api.leave('room-1', input), (error: unknown) => error instanceof RoomApiError && error.code === 'network_error')
    assert.equal(bodies.length, 1)
    await api.leave('room-1', input)
    assert.deepEqual(bodies, [JSON.stringify(input), JSON.stringify(input)])
})

test('leave preserves closure errors and rejects invalid acknowledgements', async () => {
    const input = { command_id: 'leave-command' }
    const closedApi = createRoomApi({ fetch: async () => json({ detail: { code: 'room_closed', message: 'The host has closed this lobby.' } }, 410) })
    await assert.rejects(closedApi.leave('room-1', input), (error: unknown) => error instanceof RoomApiError && error.code === 'room_closed' && error.status === 410)
    for (const payload of [{ room_id: 'other', room_version: 3, status: 'left' }, { room_id: 'room-1', room_version: 0, status: 'left' }, { room_id: 'room-1', room_version: 3, status: 'ok' }]) {
        const api = createRoomApi({ fetch: async () => json(payload) })
        await assert.rejects(api.leave('room-1', input), (error: unknown) => error instanceof RoomApiError && error.code === 'invalid_response')
    }
    let calls = 0
    const cancelled = createRoomApi({ fetch: async () => { calls++; return json({}) } })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(cancelled.leave('room-1', input, controller.signal), { name: 'AbortError' })
    assert.equal(calls, 0)
})

test('public catalog forwards cancellation without a player credential', async () => {
    const signal = new AbortController().signal
    const api = createRoomApi({ baseUrl: 'http://local.test:8000/', fetch: async (url, init) => {
        assert.equal(String(url), 'http://local.test:8000/api/scenarios')
        assert.equal(init?.credentials, 'include')
        assert.equal(init?.method, 'GET')
        assert.equal(init?.signal, signal)
        assert.deepEqual(init?.headers, {})
        return json(catalog)
    } })
    assert.deepEqual(await api.scenarios(signal), catalog)
})

test('create, join, and Start preserve the exact caller body and command ID on explicit retries', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const api = createRoomApi({ baseUrl: '', fetch: async (url, init) => {
        calls.push({ url: String(url), init })
        return json(lobby, 201)
    } })
    const create = Object.freeze({ command_id: 'create-id', room_code: 'ABC123', display_name: 'Host' })
    const join = Object.freeze({ command_id: 'join-id', room_code: 'ABC123', display_name: 'Guest', role_id: 'finance' })
    const start: StartRoomInput = {
        command_id: 'start-id', room_code: 'ABC123', scenario_id: catalog[0].scenario_id,
        scenario_version: 3, timing_profile: 'standard_18', players: [{ member_id: 'host-1', role_id: 'ceo' }],
    }
    await api.create(create)
    await api.join(join)
    await api.start('room/1', start)
    await api.start('room/1', start)
    assert.deepEqual(calls.map((call) => call.url), ['/api/rooms', '/api/rooms/join', '/api/rooms/room%2F1/start', '/api/rooms/room%2F1/start'])
    assert.deepEqual(calls.map((call) => JSON.parse(String(call.init?.body))), [create, join, start, start])
    for (const { init } of calls) {
        assert.equal(init?.credentials, 'include')
        assert.equal(init?.method, 'POST')
        assert.deepEqual(init?.headers, { 'X-Boardroom-Session': 'test-tab-token', 'Content-Type': 'application/json' })
    }
})

test('snapshot keeps equal room versions and current presence fields from the server', async () => {
    const current = { ...lobby, members: [{ ...lobby.members[0], connected: false }] }
    const api = createRoomApi({ fetch: async () => json(current) })
    assert.deepEqual(await api.snapshot('room-1'), current)
})

test('accepts the real started projection and leaves released documents unchanged', async () => {
    const started: RoomSnapshot = { ...lobby, phase: 'briefing', game: {
        phase_id: 'phase-1', round_id: 'round-1', round_number: 1, started_at: '2026-11-07T23:00:00Z',
        scenario: catalog[0], timing_profile: 'standard_18', briefing_seconds: 90, result_seconds: 30,
        initial_node_id: 'incident', facts: { incident: true, count: 0, note: null },
        public_documents: [{ id: 'briefing', text: 'Released briefing' }], eligible_member_ids: ['host-1'], ending_label: null,
    } }
    const api = createRoomApi({ fetch: async () => json(started) })
    assert.deepEqual(await api.snapshot('room-1'), started)
})

test('preserves domain status, error code and actionable message', async () => {
    const api = createRoomApi({ fetch: async () => json({ detail: { code: 'roster_changed', message: 'Refresh all registered members' } }, 409) })
    await assert.rejects(api.snapshot('room-1'), (error: unknown) => {
        assert.ok(error instanceof RoomApiError)
        assert.equal(error.status, 409)
        assert.equal(error.code, 'roster_changed')
        assert.equal(error.message, 'Refresh all registered members')
        return true
    })
})

test('retains validation field details without submitted input or context', async () => {
    const api = createRoomApi({ fetch: async () => json({ detail: [{
        loc: ['body', 'players', 0, 'role_id'], type: 'missing', msg: 'Field required',
        input: 'private supplied value', ctx: { sensitive: 'hidden' },
    }] }, 422) })
    await assert.rejects(api.snapshot('room-1'), (error: unknown) => {
        assert.ok(error instanceof RoomApiError)
        assert.equal(error.status, 422)
        assert.equal(error.code, 'validation_error')
        assert.deepEqual(error.details, [{ loc: ['body', 'players', 0, 'role_id'], type: 'missing', msg: 'Field required' }])
        assert.match(error.message, /body.players.0.role_id: Field required/)
        assert.doesNotMatch(JSON.stringify(error), /private|sensitive|hidden/)
        return true
    })
})

test('transport failures are explicit and never automatically retry a command', async () => {
    let calls = 0
    const api = createRoomApi({ fetch: async () => { calls += 1; throw new TypeError('Failed to fetch') } })
    await assert.rejects(api.create({ command_id: 'same-id', room_code: 'ABC123', display_name: 'Host' }), (error: unknown) => {
        assert.ok(error instanceof RoomApiError)
        assert.equal(error.code, 'network_error')
        assert.equal(error.status, null)
        return true
    })
    assert.equal(calls, 1)
})

test('abort reaches fetch and preserves the original cancellation error', async () => {
    const controller = new AbortController()
    const cancellation = new DOMException('Cancelled', 'AbortError')
    const api = createRoomApi({ fetch: async (_url, init) => {
        assert.equal(init?.signal, controller.signal)
        controller.abort()
        throw cancellation
    } })
    await assert.rejects(api.snapshot('room-1', controller.signal), (error: unknown) => error === cancellation)
})

test('abort while reading a response is also preserved', async () => {
    const cancellation = new DOMException('Cancelled', 'AbortError')
    const response = json(lobby)
    response.json = async () => { throw cancellation }
    const api = createRoomApi({ fetch: async () => response })
    await assert.rejects(api.snapshot('room-1'), (error: unknown) => error === cancellation)
})

test('malformed successful JSON and mismatched wire shapes report invalid_response', async () => {
    for (const response of [new Response('<html>upstream failure</html>'), json({ room_id: 'missing-fields' }), json({ ...lobby, phase: 'unknown' })]) {
        const api = createRoomApi({ fetch: async () => response })
        await assert.rejects(api.snapshot('room-1'), (error: unknown) => error instanceof RoomApiError && error.code === 'invalid_response')
    }
})

test('non JSON HTTP failures retain status without exposing arbitrary response content', async () => {
    const api = createRoomApi({ fetch: async () => new Response('sensitive proxy debug response', { status: 502 }) })
    await assert.rejects(api.snapshot('room-1'), (error: unknown) => {
        assert.ok(error instanceof RoomApiError)
        assert.equal(error.code, 'http_error')
        assert.equal(error.status, 502)
        assert.doesNotMatch(error.message, /sensitive/)
        return true
    })
})

test('every authenticated operation includes the selected tab credential', async () => {
    const calls: RequestInit[] = []
    const api = createRoomApi({ fetch: async (_url, init) => { calls.push(init!); return json(lobby) } })
    await api.snapshot('room-1')
    await api.join({ command_id: 'rename-intent', room_code: 'ABC123', display_name: 'Updated Host' })
    assert.equal(calls.length, 2)
    for (const call of calls) assert.equal(new Headers(call.headers).get('X-Boardroom-Session'), 'test-tab-token')
    assert.deepEqual(JSON.parse(String(calls[1].body)), { command_id: 'rename-intent', room_code: 'ABC123', display_name: 'Updated Host' })
})

test('concurrent room commands await one tab bootstrap before sending the original bodies', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    let finishBootstrap: (() => void) | undefined
    const wait = new Promise<void>((resolve) => { finishBootstrap = resolve })
    const api = makeRoomApi({ baseUrl: '', session: createTabSession({ randomId: () => 'fresh-tab' }), fetch: async (url, init) => {
        calls.push({ url: String(url), init })
        if (String(url) === '/api/tab-sessions') {
            await wait
            return json({ status: 'ready', session_token: 'fresh-tab-credential' })
        }
        return json(lobby)
    } })
    const input = { command_id: 'explicit-intent', room_code: 'ABC123', display_name: 'Host' }
    const pending = [api.create(input), api.join(input)]
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(calls.map((call) => call.url), ['/api/tab-sessions'])
    finishBootstrap!()
    await Promise.all(pending)
    assert.deepEqual(calls.map((call) => call.url), ['/api/tab-sessions', '/api/rooms', '/api/rooms/join'])
    for (const call of calls.slice(1)) {
        assert.equal(new Headers(call.init?.headers).get('X-Boardroom-Session'), 'fresh-tab-credential')
        assert.deepEqual(JSON.parse(String(call.init?.body)), input)
    }
})

test('accepts every implemented gameplay phase and preserves caller ballot privacy', async () => {
    for (const phase of ['reading', 'speaking', 'discussion', 'individual_decision', 'private_session', 'voting', 'tie_break', 'result', 'ended'] as const) {
        const value = { ...lobby, phase, game: {
            phase_id: 'phase-current', round_id: 'round-current', round_number: 1, started_at: '2026-11-08T00:00:00Z',
            scenario: catalog[0], timing_profile: 'standard_18', briefing_seconds: 90, result_seconds: 30,
            initial_node_id: 'incident', facts: {}, public_documents: [], eligible_member_ids: ['host-1'],
            ending_label: null, self_vote: 'prepared-1', vote_counts: phase === 'voting' ? null : {},
            allowed_actions: ['vote'], phase_deadline: '2026-11-08T00:01:00Z', server_time: '2026-11-08T00:00:00Z',
        } }
        const api = createRoomApi({ fetch: async () => json(value) })
        assert.deepEqual(await api.snapshot('room-1'), value)
    }
})

test('retained contributions are followed by an authoritative snapshot without resubmitting', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const api = createRoomApi({ baseUrl: '', fetch: async (url, init) => {
        calls.push({ url: String(url), init })
        return String(url).endsWith('/contributions') ? json({ contribution_id: 'accepted' }, 201) : json(lobby)
    } })
    const input = { command_id: 'stable', phase_id: 'phase', kind: 'chat', source: 'typed', text: 'Preserve evidence.' }
    assert.deepEqual(await api.command('room-1', 'contributions', input), lobby)
    assert.deepEqual(calls.map((call) => call.url), ['/api/rooms/room-1/contributions', '/api/rooms/room-1'])
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), input)
    assert.equal(calls[1].init?.method, 'GET')
})

test('original recording playback is fetched with the private tab header and no JSON body', async () => {
    const api = createRoomApi({ baseUrl: '', fetch: async (url, init) => {
        assert.equal(String(url), '/api/rooms/room%2F1/recordings/record%2F1/audio')
        assert.equal(new Headers(init?.headers).get('X-Boardroom-Session'), 'test-tab-token')
        assert.equal(new Headers(init?.headers).get('Content-Type'), null)
        assert.equal(init?.body, undefined)
        return new Response(new Blob(['original'], { type: 'audio/webm' }))
    } })
    const audio = await api.audio('room/1', 'record/1')
    assert.equal(await audio.text(), 'original')
})
