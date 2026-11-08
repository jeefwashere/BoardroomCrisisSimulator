import type { RoomSnapshot } from '../../services/rooms.ts'

/** Controls follow the server's current action grant, never a display name. */
export function callControls(room: RoomSnapshot) {
    const actions = room.game?.allowed_actions ?? []
    return {
        canFinish: actions.includes('finish_speaking'),
        canSkipTurn: actions.includes('skip_speaker'),
        canFinishRound: ['speaking', 'discussion'].includes(room.phase) && actions.includes('skip_phase'),
        canWrite: ['speaking', 'discussion'].includes(room.phase) && !!room.members.find((member) => member.member_id === room.self_member_id)?.eligible_current_round,
        reviewing: ['result', 'ended'].includes(room.phase),
    }
}
