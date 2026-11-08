import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { dummySummaryApi } from '../dev/summaryApi.ts'
import { buildSummaryCards, isRoomSummaryResponse, isSummaryEmailReceipt, roomSummaryEndpoint, summaryEmailError } from '../src/features/summary/summaryModel.ts'
import type { LobbyMember } from '../src/features/lobby/lobbyModel.ts'
import { fetchRoomSummary, requestSummaryEmail } from '../src/services/summaries.ts'

const originalFetch = globalThis.fetch
const server = createServer((request, response) => {
    dummySummaryApi(request, response, () => { response.writeHead(404).end() })
})
let baseUrl = ''

before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    baseUrl = `http://127.0.0.1:${address.port}`
    globalThis.fetch = (input, init) => originalFetch(typeof input === 'string' && input.startsWith('/') ? baseUrl + input : input, init)
})

after(async () => {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('summary cards retain all 30 roster members and match summaries by ID, including duplicate names', () => {
    const members: LobbyMember[] = Array.from({ length: 30 }, (_, index) => ({ id: `p${index}`, name: 'Alex', role: 'unassigned', isHost: index === 0 }))
    const cards = buildSummaryCards(members, {
        roomCode: 'DEMO01', status: 'ready', summaries: [
            { memberId: 'p1', text: '  Led the discussion.  ' },
            { memberId: 'p2', text: '   ' },
            { memberId: 'unknown', text: 'Not a participant.' },
        ],
    })
    assert.equal(cards.length, 30)
    assert.deepEqual(cards.map((card) => card.id), members.map((member) => member.id))
    assert.equal(cards[0].summary, null)
    assert.equal(cards[0].isHost, true)
    assert.equal(cards[1].summary, 'Led the discussion.')
    assert.equal(cards[2].summary, null)
    assert.equal(buildSummaryCards(members, null).every((card) => card.summary === null), true)
    assert.deepEqual(buildSummaryCards([], null), [])
})

test('summary response validation rejects malformed and ambiguous participant data', () => {
    assert.ok(isRoomSummaryResponse({ roomCode: 'DEMO01', status: 'pending', summaries: [] }))
    for (const value of [null, {}, { roomCode: 'A', status: 'other', summaries: [] }, { roomCode: 'A', status: 'ready', summaries: [{ memberId: '', text: 'x' }] }, { roomCode: 'A', status: 'ready', summaries: [{ memberId: 'p1', text: 42 }] }, { roomCode: 'A', status: 'ready', summaries: [{ memberId: 'p1', text: 'a' }, { memberId: 'p1', text: 'b' }] }]) {
        assert.equal(isRoomSummaryResponse(value), false)
    }
})

test('email validation accepts trimmed addresses and rejects missing or malformed recipients', () => {
    assert.equal(summaryEmailError(' player@example.test '), null)
    for (const value of ['', 'player', 'player@', 'player@a b.test', 'player@example.test\r\nBcc:other@example.test', 'a'.repeat(255) + '@example.test']) {
        assert.equal(typeof summaryEmailError(value), 'string')
    }
})

test('the summary adapter reads the explicit pending response without generating data', async () => {
    const result = await fetchRoomSummary('DEMO01')
    assert.deepEqual(result, { roomCode: 'DEMO01', status: 'pending', summaries: [] })
    assert.equal(roomSummaryEndpoint('A/B'), '/api/rooms/A%2FB/summary')
    assert.equal((await fetchRoomSummary('A/B')).roomCode, 'A/B')
})

test('the email adapter submits the typed address and receives a preview with no message sent', async () => {
    const receipt = await requestSummaryEmail('DEMO01', ' player@example.test ')
    assert.ok(isSummaryEmailReceipt(receipt))
    assert.equal(receipt.recipient, 'player@example.test')
    assert.equal(receipt.sent, false)
    assert.match(receipt.message, /no email was sent/)
    assert.equal(isSummaryEmailReceipt({ ...receipt, sent: true }), false)
    await assert.rejects(requestSummaryEmail('DEMO01', 'bad'), /valid email/)
})

test('summary stubs reject wrong methods, invalid JSON, invalid addresses, and oversized requests', async () => {
    const endpoint = roomSummaryEndpoint('DEMO01')
    const wrongMethod = await fetch(endpoint, { method: 'POST' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get('allow'), 'GET')
    assert.equal((await fetch(`${endpoint}/email`)).status, 405)
    assert.equal((await fetch('/unrelated')).status, 404)
    assert.equal((await fetch('/api/rooms/%ZZ/summary')).status, 400)
    for (const [body, expected] of [['{', 400], ['{}', 422], [JSON.stringify({ email: 'bad' }), 422], ['x'.repeat(8193), 413]] as const) {
        const response = await fetch(`${endpoint}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        assert.equal(response.status, expected)
    }
    assert.equal((await fetch(`${endpoint}/email`, { method: 'POST', body: '{}' })).status, 400)
})

test('summary adapters honor cancellation and reject failed, malformed, or mismatched responses', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(fetchRoomSummary('DEMO01', controller.signal), { name: 'AbortError' })
    await assert.rejects(requestSummaryEmail('DEMO01', 'p@example.test', controller.signal), { name: 'AbortError' })
    const workingFetch = globalThis.fetch
    try {
        globalThis.fetch = async () => Response.json({ message: 'Summary service offline.' }, { status: 503 })
        await assert.rejects(fetchRoomSummary('DEMO01'), /Summary service offline/)
        await assert.rejects(requestSummaryEmail('DEMO01', 'p@example.test'), /Summary service offline/)
        globalThis.fetch = async () => new Response('<html>fallback</html>')
        await assert.rejects(fetchRoomSummary('DEMO01'), /unexpected response/)
        await assert.rejects(requestSummaryEmail('DEMO01', 'p@example.test'), /unexpected response/)
        globalThis.fetch = async () => Response.json({ roomCode: 'OTHER', status: 'ready', summaries: [] })
        await assert.rejects(fetchRoomSummary('DEMO01'), /unexpected response/)
        globalThis.fetch = async () => Response.json({ requestId: 'preview', recipient: 'other@example.test', mode: 'dummy', status: 'preview', sent: false, message: 'No email sent.' })
        await assert.rejects(requestSummaryEmail('DEMO01', 'p@example.test'), /unexpected response/)
    } finally {
        globalThis.fetch = workingFetch
    }
})
