import { RoomApiError } from '../../services/rooms.ts'
import type { RoomApi } from '../../services/rooms.ts'
import { clearSeatSession } from '../../services/tabSession.ts'
import type { StoragePort } from '../../services/tabSession.ts'
import { DEMO_SEATS, DEMO_STORAGE_KEY } from './demoModel.ts'
import { SESSION_NAME_KEY } from '../identity/sessionName.ts'

export const DEMO_EXIT_MESSAGE = 'boardroom.demo.exit'

/** Demo navigation must never wait for a backend or retain its test credentials. */
export function leaveDemoImmediately(end: () => Promise<void>, discard: () => void, returnHome: () => void): void {
    try { discard() } finally { returnHome() }
    void Promise.resolve().then(end).catch(() => {})
}

export function isDemoExitRequest(event: { origin: string; source: unknown; data: unknown }, origin: string, roomId: string, frames: readonly { seat: string; source: unknown }[]): boolean {
    if (event.origin !== origin || !event.source || typeof event.data !== 'object' || event.data === null) return false
    const data = event.data as Record<string, unknown>
    return data.type === DEMO_EXIT_MESSAGE && data.roomId === roomId
        && frames.some((frame) => frame.source === event.source && frame.seat === data.seat)
}

export function clearDemoSession(storage: StoragePort | null, expectedRoomId?: string): void {
    if (!storage) return
    if (expectedRoomId) {
        try { if (JSON.parse(storage.getItem(DEMO_STORAGE_KEY) ?? 'null')?.room_id !== expectedRoomId) return }
        catch { return }
    }
    for (const { seat } of DEMO_SEATS) {
        try { clearSeatSession(storage, seat) } catch { /* Continue clearing the remaining seats. */ }
        try { storage.removeItem(`${SESSION_NAME_KEY}.${seat}`) } catch { /* Storage can be blocked. */ }
    }
    try { storage.removeItem(DEMO_STORAGE_KEY) } catch { /* Storage can be blocked. */ }
}

/** The tester always ends the room as its real host, regardless of the displayed seat. */
export function createDemoEnder(api: Pick<RoomApi, 'snapshot' | 'leave'> & Partial<Pick<RoomApi, 'command'>>, roomId: string, randomId: () => string = () => crypto.randomUUID()) {
    let leaveIntent: { command_id: string } | null = null
    let endIntent: { command_id: string; phase_id: string } | null = null
    const gone = (failure: unknown) => failure instanceof RoomApiError && ['room_closed', 'host_disconnected', 'room_not_found'].includes(failure.code)
    return async () => {
        try {
            const room = await api.snapshot(roomId)
            if (room.self_member_id !== room.host_member_id) throw new Error('The demo host session is unavailable. Reconnect before leaving.')
            leaveIntent ??= { command_id: randomId() }
            try {
                const receipt = await api.leave(roomId, leaveIntent)
                if (receipt.status !== 'closed') throw new Error('The server did not confirm that the demo session closed.')
            } catch (failure) {
                // Older running backends only allow Leave in the lobby. The demo
                // can still end their active session using the existing host command.
                if (!(failure instanceof RoomApiError) || failure.code !== 'already_started') throw failure
                if (room.phase === 'ended') return
                if (!room.game || !api.command) throw failure
                if (endIntent?.phase_id !== room.game.phase_id) endIntent = { command_id: randomId(), phase_id: room.game.phase_id }
                await api.command(roomId, 'end', endIntent)
            }
        } catch (failure) {
            if (gone(failure)) return
            throw failure
        }
    }
}
