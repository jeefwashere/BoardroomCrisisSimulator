// Pure presentation helpers for the facilitation panel (no JSX, no network) so they can be unit tested.
import type { AdviserKind, Consultation, RecordedClip, RecordingGroup } from '../../services/facilitation.ts'
import type { RoomMember } from '../../services/rooms.ts'

export const RECORDING_GROUP_ORDER: readonly RecordingGroup[] = [
    'decision_guide', 'participant', 'facilitator', 'adviser', 'journalist', 'discussion', 'control', 'reference',
]

export const RECORDING_GROUP_LABELS: Record<RecordingGroup, string> = {
    decision_guide: 'Decision guide',
    participant: 'Participant turns',
    facilitator: 'Facilitator',
    adviser: 'IT adviser',
    journalist: 'Journalist',
    discussion: 'Discussion examples',
    control: 'Control',
    reference: 'Reference',
}

export type ClipGroup = { group: string; label: string; clips: RecordedClip[] }

function titleCase(value: string): string {
    const words = value.replaceAll('_', ' ').trim()
    return words ? words[0].toUpperCase() + words.slice(1) : 'Other'
}

/** Groups clips in the fixed display order. Unknown groups follow the known ones; clip order is preserved. */
export function groupClips(clips: readonly RecordedClip[]): ClipGroup[] {
    const buckets = new Map<string, RecordedClip[]>()
    for (const clip of clips) {
        const bucket = buckets.get(clip.group)
        if (bucket) bucket.push(clip)
        else buckets.set(clip.group, [clip])
    }
    const rank = (group: string) => {
        const index = RECORDING_GROUP_ORDER.indexOf(group as RecordingGroup)
        return index === -1 ? RECORDING_GROUP_ORDER.length : index
    }
    return [...buckets.entries()]
        .sort(([a], [b]) => rank(a) - rank(b))
        .map(([group, items]) => ({ group, label: RECORDING_GROUP_LABELS[group as RecordingGroup] ?? titleCase(group), clips: items }))
}

export function decisionGuideClip(clips: readonly RecordedClip[]): RecordedClip | null {
    return clips.find((clip) => clip.group === 'decision_guide') ?? null
}

/** Formats seconds as m:ss. Missing, negative or non-finite values return an empty string. */
export function formatDuration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ''
    const whole = Math.round(seconds)
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Progress fraction in [0, 1]. */
export function progressFraction(current: number, duration: number): number {
    if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return 0
    return Math.min(1, Math.max(0, current / duration))
}

// Suggested questions. The first of each comes from playtest/ROUNDTABLE_GUIDE.md (Live advisers).
export const SUGGESTED_QUESTIONS: Record<AdviserKind, readonly string[]> = {
    facilitator: [
        'Which assumptions should we clarify before choosing a response?',
        'Can you summarize the trade offs between our options so far?',
        'Whose view have we not heard yet, and what should we ask them?',
    ],
    it: [
        'What must be verified before we promise a restoration time?',
        'Which systems and backups does recovery depend on?',
        'What evidence should we preserve before changing anything?',
    ],
    journalist: [
        'What can we communicate while recovery remains uncertain?',
        'Which facts are confirmed, and which are still unknown?',
        'What will customers want to hear from us first?',
    ],
}

export const ADVISER_ACCENTS: Record<AdviserKind, string> = {
    facilitator: '#354c3c',
    it: '#3d5a80',
    journalist: '#ae5238',
}

export function adviserInitials(label: string): string {
    const words = label.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return '?'
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
    return (words[0][0] + words[1][0]).toUpperCase()
}

export function askerName(members: readonly RoomMember[], memberId: string, selfId: string): string {
    if (memberId === selfId) return 'You'
    return members.find((member) => member.member_id === memberId)?.display_name ?? 'A former participant'
}

export function replySourceLabel(source: Consultation['source']): string {
    if (source === 'offline') return 'Offline reply'
    if (source === 'hosted') return 'AI reply'
    return ''
}

/** Newest first; ties keep a stable order by id. */
export function orderConsultations(consultations: readonly Consultation[]): Consultation[] {
    return [...consultations].sort((a, b) => {
        const delta = Date.parse(b.at) - Date.parse(a.at)
        return Number.isFinite(delta) && delta !== 0 ? delta : a.consultation_id.localeCompare(b.consultation_id)
    })
}

/** Merges a locally received consultation into the polled list without duplicating it. */
export function mergeConsultation(consultations: readonly Consultation[], incoming: Consultation): Consultation[] {
    const index = consultations.findIndex((item) => item.consultation_id === incoming.consultation_id)
    if (index === -1) return [...consultations, incoming]
    if (consultations[index].status !== 'pending') return [...consultations]
    return consultations.map((item, position) => position === index ? incoming : item)
}

export function hasOwnPending(consultations: readonly Consultation[], selfId: string): boolean {
    return consultations.some((item) => item.member_id === selfId && item.status === 'pending')
}

export type AskBlock = { blocked: boolean; reason: string }

export function askAvailability(phase: string, ownPending: boolean, submitting: boolean): AskBlock {
    if (phase === 'lobby') return { blocked: true, reason: 'Advisers become available once the meeting starts.' }
    if (phase === 'ended') return { blocked: true, reason: 'The meeting has ended. Earlier replies remain readable.' }
    if (submitting) return { blocked: true, reason: 'Sending your question…' }
    if (ownPending) return { blocked: true, reason: 'Your previous question is still being answered.' }
    return { blocked: false, reason: '' }
}
