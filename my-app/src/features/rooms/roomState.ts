import type { RoomSnapshot, Scenario, StartRoomInput } from '../../services/rooms.ts'
import type { LobbyMember } from '../lobby/lobbyModel.ts'

export type RoleDraft = Record<string, string>

export function acceptSnapshot(current: RoomSnapshot | null, incoming: RoomSnapshot): RoomSnapshot {
    if (current && current.room_id !== incoming.room_id) return current
    return current && incoming.room_version < current.room_version ? current : incoming
}

export function roomMembers(room: RoomSnapshot, draft: RoleDraft = {}, scenario?: Scenario): LobbyMember[] {
    return room.members.map((member) => ({
        id: member.member_id,
        name: member.display_name,
        isHost: member.is_host,
        role: room.phase === 'lobby' ? draft[member.member_id] ?? 'unassigned' : member.role_id ?? 'unassigned',
        roleLabel: scenario?.roles.find((role) => role.role_id === member.role_id)?.name,
        connected: member.connected,
        eligibleFromRound: member.eligible_from_round,
        eligibleCurrentRound: member.eligible_current_round,
    }))
}

/** One CEO only: giving someone the CEO role takes it from whoever had it (they go back to choosing a role). */
export function assignRole(draft: RoleDraft, memberId: string, role: string): RoleDraft {
    const next: RoleDraft = { ...draft, [memberId]: role }
    if (role === 'ceo') for (const [other, current] of Object.entries(next)) if (other !== memberId && current === 'ceo') next[other] = 'unassigned'
    return next
}

export function startProblem(room: RoomSnapshot, scenario: Scenario | undefined, draft: RoleDraft): string | null {
    if (room.self_member_id !== room.host_member_id) return 'Only the host can start this room.'
    if (room.phase !== 'lobby') return 'This room has already started.'
    if (!scenario) return 'Select an available scenario.'
    if (room.members.filter((member) => member.connected).length < 3) return 'At least 3 active participants must join before Start.'
    if (room.members.some((member) => !scenario.roles.some((role) => role.role_id === draft[member.member_id]))) return 'Assign a scenario role to every participant.'
    if (room.members.filter((member) => draft[member.member_id] === 'ceo').length !== 1) return 'Assign exactly one CEO. The host can hold any role.'
    return null
}

export function startInput(room: RoomSnapshot, scenario: Scenario, timing: string, draft: RoleDraft, commandId: string): StartRoomInput {
    const problem = startProblem(room, scenario, draft)
    if (problem) throw new Error(problem)
    if (!scenario.timings.some((profile) => profile.profile_id === timing)) throw new Error('Choose an available timing profile.')
    return {
        command_id: commandId,
        room_code: room.room_code,
        scenario_id: scenario.scenario_id,
        scenario_version: scenario.version,
        timing_profile: timing,
        players: room.members.map((member) => ({ member_id: member.member_id, role_id: draft[member.member_id] })),
    }
}

// This scheduler waits for each request before scheduling the next one.
export function pollRoom<T>(
    read: (signal: AbortSignal) => Promise<T>,
    receive: (room: T) => void,
    failed: (error: unknown) => void,
    interval = 2000,
    subscribeResume?: (resume: () => void) => () => void,
    /** Stop polling once this holds for a received value (a game that has ended no longer changes). */
    until?: (value: T) => boolean,
): () => void {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false
    let resumePending = false
    async function tick() {
        if (controller.signal.aborted || running) return
        running = true
        try {
            const room = await read(controller.signal)
            if (!controller.signal.aborted) {
                receive(room)
                if (until?.(room)) { controller.abort(); unsubscribe?.() }
            }
        } catch (error) {
            if (!controller.signal.aborted) failed(error)
        } finally {
            running = false
            if (!controller.signal.aborted) {
                const delay = resumePending ? 0 : interval
                resumePending = false
                timer = setTimeout(() => void tick(), delay)
            }
        }
    }
    // Declared before the first tick runs, so `tick` can unsubscribe when `until` holds.
    const unsubscribe = subscribeResume?.(() => {
        if (controller.signal.aborted) return
        clearTimeout(timer)
        if (running) resumePending = true
        else void tick()
    })
    void tick()
    return () => { controller.abort(); clearTimeout(timer); unsubscribe?.() }
}
