// Pure logic for the saved participant clips (playtest "Play each participant manually"); no JSX, no network.
import type { RecordedClip } from '../../services/facilitation.ts'

/** Recorded participant turns, assigned by the member's index in `game.eligible_member_ids`. */
export const PARTICIPANT_CLIP_IDS = ['t01_leadership_turn', 't01_recovery_turn', 't01_communications_turn'] as const

export type ClipAssignment = { memberId: string; seat: number; clip: RecordedClip }

/**
 * Members at index 0, 1 and 2 of the eligible list receive the leadership, recovery and communications clip.
 * Anyone further down the list gets none. A clip missing from the catalog leaves its seat without a card.
 */
export function assignSavedClips(eligibleMemberIds: readonly string[], catalog: readonly RecordedClip[]): ClipAssignment[] {
    const assignments: ClipAssignment[] = []
    PARTICIPANT_CLIP_IDS.forEach((clipId, seat) => {
        const memberId = eligibleMemberIds[seat]
        const clip = catalog.find((item) => item.clip_id === clipId && item.group === 'participant')
        if (memberId && clip) assignments.push({ memberId, seat, clip })
    })
    return assignments
}

export function clipForMember(assignments: readonly ClipAssignment[], memberId: string): RecordedClip | null {
    return assignments.find((item) => item.memberId === memberId)?.clip ?? null
}

export type TurnView = { phase: string; phaseId: string; activeSpeakerId: string | null | undefined; selfId: string }

/** Identity of a speaking turn: the phase instance and its speaker. Null outside a speaking turn. */
export function turnKey(view: TurnView): string | null {
    if (view.phase !== 'speaking' || !view.activeSpeakerId) return null
    return `${view.phaseId}:${view.activeSpeakerId}`
}

export function isOwnTurn(view: TurnView): boolean {
    return view.phase === 'speaking' && !!view.activeSpeakerId && view.activeSpeakerId === view.selfId
}

export function cardStatus(view: TurnView, memberId: string): { label: string; speaking: boolean } {
    const speaking = view.phase === 'speaking' && view.activeSpeakerId === memberId
    return speaking ? { label: 'SPEAKING NOW', speaking } : { label: 'Waiting for turn', speaking }
}

export type CommitInput = {
    view: TurnView
    /** The caller's assigned clip, if any. */
    clip: RecordedClip | null
    /** Turn key captured when the caller's own clip last played to the end; null if it never finished. */
    finishedTurn: string | null
    busy: boolean
}

export type CommitEligibility = { allowed: boolean; reason: string }

/**
 * Committing posts the exact caption as the caller's contribution and passes the turn.
 * It needs the caller's own live turn, an assigned clip with a caption, and a full playback during this same turn.
 * Playback alone never commits; a turn change (new phase or speaker) makes an earlier playback stale.
 */
export function commitEligibility({ view, clip, finishedTurn, busy }: CommitInput): CommitEligibility {
    if (!isOwnTurn(view)) return { allowed: false, reason: 'Wait for your speaking turn.' }
    if (!clip) return { allowed: false, reason: 'No saved clip is assigned to you.' }
    if (!clip.text.trim()) return { allowed: false, reason: 'This clip has no caption to commit.' }
    if (busy) return { allowed: false, reason: 'Saving…' }
    if (finishedTurn === null) return { allowed: false, reason: 'Play your saved clip to the end before committing its caption.' }
    if (finishedTurn !== turnKey(view)) return { allowed: false, reason: 'Your earlier playback belongs to a previous turn. Play the clip again.' }
    return { allowed: true, reason: '' }
}
