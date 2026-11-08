import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomApiError } from '../src/services/rooms.ts'
import { sessionClosure, sessionClosureMessage } from '../src/features/rooms/sessionClosure.ts'

test('host closure and host disconnect retain distinct authoritative messages', () => {
    assert.equal(sessionClosure(new RoomApiError('Closed', 'room_closed', 410)), 'host_ended')
    assert.equal(sessionClosure(new RoomApiError('Lost host', 'host_disconnected', 410)), 'host_disconnected')
    assert.equal(sessionClosureMessage('host_ended'), 'The session has been ended by the host.')
    assert.equal(sessionClosureMessage('host_disconnected'), 'The host has been disconnected.')
})

test('transient connection failures and unrelated errors never claim the host ended the session', () => {
    for (const error of [new Error('Offline'), new RoomApiError('Offline', 'network_error', null), new RoomApiError('Invalid', 'host_disconnected', 422), new RoomApiError('Not a member', 'not_a_member', 403), null]) {
        assert.equal(sessionClosure(error), null)
    }
})
