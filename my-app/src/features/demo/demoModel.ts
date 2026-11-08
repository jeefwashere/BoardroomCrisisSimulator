import type { RoomSnapshot, Scenario } from '../../services/rooms.ts'
import type { RoleDraft } from '../rooms/roomState.ts'

// Three test memberships driven from one browser window. Seat IDs namespace
// each frame's tab session storage (see seatStorage in services/tabSession).
export const DEMO_SEATS = [
    { seat: 'alex', name: 'Alex' },
    { seat: 'morgan', name: 'Morgan' },
    { seat: 'sam', name: 'Sam' },
] as const

export type DemoSeat = (typeof DEMO_SEATS)[number]['seat']
export const DEMO_STORAGE_KEY = 'boardroom.demoRoom'

export type StoredDemo = { room_id: string; room_code: string }

export function readStoredDemo(raw: string | null): StoredDemo | null {
    if (!raw) return null
    try {
        const value: unknown = JSON.parse(raw)
        if (typeof value !== 'object' || value === null) return null
        const { room_id: roomId, room_code: roomCode } = value as Record<string, unknown>
        return typeof roomId === 'string' && /^[0-9a-f-]{36}$/i.test(roomId) && typeof roomCode === 'string' && /^[A-Z0-9]{6}$/.test(roomCode)
            ? { room_id: roomId, room_code: roomCode } : null
    } catch { return null }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function demoRoomCode(random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))): string {
    return Array.from(random(6), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

export const DEMO_SCENARIO_ID = 'cedar_bridge_t01'
export type BallotSource = 'authored' | 'ai'

/** The hardcoded T01 Cedar Bridge test when the catalog lists it, else the first scenario. */
export function pickDemoScenario(catalog: readonly Scenario[]): Scenario | undefined {
    return catalog.find((scenario) => scenario.scenario_id === DEMO_SCENARIO_ID) ?? catalog[0]
}

// Seat order maps the saved T01 clips: leadership, recovery, communications.
const SEAT_ROLE_PATTERNS = [/recovery|technology|\bit\b/i, /communications?/i]

/** Alex is CEO; Morgan takes the recovery/IT role and Sam the communications role, else distinct roles in order. */
export function demoRoles(room: RoomSnapshot, memberIds: readonly string[], scenario: Scenario): RoleDraft {
    const others = scenario.roles.filter((role) => role.role_id !== 'ceo')
    if (!scenario.roles.some((role) => role.role_id === 'ceo')) throw new Error('The demo scenario has no CEO role.')
    if (others.length === 0) throw new Error('The demo scenario has no other roles to assign.')
    const chosen: string[] = []
    SEAT_ROLE_PATTERNS.forEach((pattern) => {
        const match = others.find((role) => !chosen.includes(role.role_id) && (pattern.test(role.role_id.replaceAll('_', ' ')) || pattern.test(role.name)))
        chosen.push(match?.role_id ?? '')
    })
    chosen.forEach((roleId, index) => {
        if (roleId) return
        const unused = others.find((role) => !chosen.includes(role.role_id))
        chosen[index] = unused?.role_id ?? others[index % others.length].role_id
    })
    const draft: RoleDraft = {}
    memberIds.forEach((memberId, index) => { draft[memberId] = index === 0 ? 'ceo' : chosen[(index - 1) % chosen.length] })
    // Any member who joined from elsewhere still needs a role for Start.
    room.members.forEach((member, index) => { draft[member.member_id] ??= others[index % others.length].role_id })
    return draft
}

export type SeatStatus = {
    phase: RoomSnapshot['phase'] | null
    roleId: string | null
    speaking: boolean
    decide: boolean
    voted: boolean
    ceoTie: boolean
}

export function seatStatus(snapshot: RoomSnapshot | null | undefined): SeatStatus {
    if (!snapshot) return { phase: null, roleId: null, speaking: false, decide: false, voted: false, ceoTie: false }
    const self = snapshot.members.find((member) => member.member_id === snapshot.self_member_id)
    const roleId = self?.role_id ?? null
    const game = snapshot.game
    const eligible = Boolean(game && (game.allowed_actions?.includes('vote') ?? game.eligible_member_ids.includes(snapshot.self_member_id)))
    const voting = snapshot.phase === 'voting' && eligible
    return {
        phase: snapshot.phase,
        roleId,
        speaking: snapshot.phase === 'speaking' && game?.active_speaker_id === snapshot.self_member_id,
        decide: voting && game?.self_vote == null,
        voted: voting && game?.self_vote != null,
        ceoTie: snapshot.phase === 'tie_break' && roleId === 'ceo',
    }
}

/**
 * Which seat the single window view should show, mirroring the playtest:
 * the current speaker, then the next member who still has to vote in seat
 * order (the CEO once everyone voted), and the CEO during a tie break.
 * Returns null when the phase does not call for a specific seat.
 */
export function followTarget(snapshots: readonly (RoomSnapshot | null | undefined)[]): number | null {
    const statuses = snapshots.map(seatStatus)
    const phase = statuses.find((status) => status.phase)?.phase ?? null
    const ceo = statuses.findIndex((status) => status.roleId === 'ceo')
    if (phase === 'speaking') {
        const speaker = statuses.findIndex((status) => status.speaking)
        return speaker >= 0 ? speaker : null
    }
    if (phase === 'voting') {
        const next = statuses.findIndex((status) => status.decide)
        return next >= 0 ? next : ceo >= 0 ? ceo : null
    }
    if (phase === 'tie_break') return ceo >= 0 ? ceo : null
    return null
}

export function phaseLabel(phase: SeatStatus['phase']): string {
    return phase ? phase.replaceAll('_', ' ') : 'connecting'
}
