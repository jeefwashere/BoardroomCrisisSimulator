import { RoomApiError } from '../../services/rooms.ts'

export type SessionClosure = 'host_ended' | 'host_disconnected'

export function sessionClosure(failure: unknown): SessionClosure | null {
    if (!(failure instanceof RoomApiError) || failure.status !== 410) return null
    if (failure.code === 'room_closed') return 'host_ended'
    return failure.code === 'host_disconnected' ? 'host_disconnected' : null
}

export function sessionClosureMessage(reason: SessionClosure): string {
    return reason === 'host_disconnected' ? 'The host has been disconnected.' : 'The session has been ended by the host.'
}
