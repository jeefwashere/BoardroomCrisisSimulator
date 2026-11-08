// Pure helpers for the bottom call control bar (no JSX, no network) so they can be unit tested.
import type { CaptureState } from './manualRecorder.ts'
import { DICTATION_UNAVAILABLE } from './dictationModel.ts'

/** The incident report belongs to the opening session only: the briefing and the reading time after it. */
export function offersReport(phase: string): boolean {
    return phase === 'briefing' || phase === 'reading'
}

/** Host skip label for the current phase; the server decides whether `skip_phase` is allowed. */
export const SKIP_LABELS: Readonly<Record<string, string>> = {
    briefing: 'Skip briefing', reading: 'Skip reading', speaking: 'Skip remaining turns',
    discussion: 'Skip to decisions', individual_decision: 'Close decisions', private_session: 'End private sessions', voting: 'Record final decision',
    tie_break: 'Skip tie break', result: 'Continue',
}

export function skipLabel(phase: string): string {
    return SKIP_LABELS[phase] ?? 'Skip phase'
}

const PHASE_TITLES: Readonly<Record<string, string>> = { individual_decision: 'Decisions', tie_break: 'Tie break', resolution_failed: 'Evaluation failed' }

/** Short phase name for the status pill ("individual_decision" reads as "Decisions"). */
export function phaseTitle(phase: string): string {
    const text = PHASE_TITLES[phase] ?? phase.replaceAll('_', ' ')
    return text ? text[0].toUpperCase() + text.slice(1) : ''
}

/** Status pill text: the phase, who holds the floor while speaking (or that it is open), or the caller's own private round. */
export function phaseCaption(phase: string, speaker: { name: string; self: boolean } | null, privateRound?: 2 | 3 | null, floorOpen = false, spokeLast = false): string {
    if (phase === 'speaking' && speaker) return speaker.self ? 'Your turn' : `${speaker.name} speaking`
    if (phase === 'speaking' && floorOpen) return spokeLast ? 'Floor open: others first' : 'Floor open'
    if (phase === 'private_session') return privateRound === 3 ? 'Assessment' : 'Private coaching'
    return phaseTitle(phase)
}

/** Clock text for the countdown pill: "0:42", "12:05". */
export function formatClock(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds))
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

type ChatRecord = { member_id: string; kind?: string }

/** New chat messages from other members since the drawer was last seen (answers and transcripts do not count). */
export function chatUnread(records: readonly ChatRecord[], selfId: string, seen: number): number {
    return Math.max(0, othersCount(records, selfId) - seen)
}

export function othersCount(records: readonly ChatRecord[], selfId: string): number {
    return records.filter((record) => record.member_id !== selfId && (record.kind ?? 'chat') === 'chat').length
}

/** Badge text: counts above nine collapse to "9+". */
export function badgeText(count: number): string {
    return count > 9 ? '9+' : String(count)
}

export type MicAction = 'claim' | 'start' | 'stop' | 'cancel' | 'retry' | 'dictate' | 'stop-dictation'
export type MicControl = { action: MicAction | null; label: string; title: string; live: boolean; muted: boolean }
export type MicInput = {
    phase: string
    phaseId: string
    ownTurn: boolean
    /** Open floor rooms: the floor is free and the caller may take it by starting to speak. */
    canClaim?: boolean
    /** Open floor rooms: the caller gave up the floor last and must let someone else speak first. */
    spokeLast?: boolean
    recording: Pick<CaptureState, 'status' | 'phaseId' | 'message' | 'retryUpload'>
    dictation: { supported: boolean; listening: boolean; blocked: boolean; ready: boolean }
}

// Phases where the Mic dictates into a text box instead of recording a speaking turn.
const DICTATION_TITLES: Readonly<Record<string, { stop: string; unready: string; ready: string }>> = {
    individual_decision: { stop: 'Stop dictating into your decision', unready: 'Open your decision for editing to dictate into it.', ready: 'Speak your decision; your words go into the text box.' },
    private_session: { stop: 'Stop dictating into your answer', unready: 'Dictation opens when your coach asks you a question.', ready: 'Speak your answer; your words go into the answer box.' },
}

/**
 * What the Mic button does right now. During individual decisions and private sessions it dictates into the open text box;
 * otherwise it records the caller's own speaking turn. A null action renders the button disabled with `title` as the reason.
 */
export function micControl({ phase, phaseId, ownTurn, canClaim = false, spokeLast = false, recording, dictation }: MicInput): MicControl {
    const titles = DICTATION_TITLES[phase]
    if (titles) {
        if (dictation.listening) return { action: 'stop-dictation', label: 'Stop', title: titles.stop, live: true, muted: false }
        if (!dictation.supported || dictation.blocked) return { action: null, label: 'Dictate', title: DICTATION_UNAVAILABLE, live: false, muted: true }
        if (!dictation.ready) return { action: null, label: 'Dictate', title: titles.unready, live: false, muted: true }
        return { action: 'dictate', label: 'Dictate', title: titles.ready, live: false, muted: true }
    }
    if (recording.status === 'requesting') return { action: 'cancel', label: 'Cancel', title: recording.message, live: false, muted: false }
    if (recording.status === 'recording') return { action: 'stop', label: 'Stop', title: 'Stop and save your recording', live: true, muted: false }
    if (recording.retryUpload) return { action: 'retry', label: 'Retry save', title: recording.message, live: false, muted: true }
    if (recording.status === 'stopping' || recording.status === 'saving') return { action: null, label: 'Saving…', title: recording.message, live: false, muted: true }
    if (recording.status === 'saved' && recording.phaseId === phaseId) return { action: null, label: 'Saved', title: 'Your recording for this turn is saved.', live: false, muted: true }
    if (ownTurn) return { action: 'start', label: 'Mic', title: 'Start recording your turn', live: false, muted: true }
    if (canClaim) return { action: 'claim', label: 'Speak', title: 'The floor is open: take it and start recording', live: false, muted: true }
    if (spokeLast && phase === 'speaking') return { action: null, label: 'Speak', title: 'You just had the floor. Someone else speaks next, then you can take it again.', live: false, muted: true }
    return { action: null, label: 'Mic', title: phase === 'speaking' ? 'You can record during your own speaking turn.' : 'The microphone opens during your own speaking turn.', live: false, muted: true }
}

/** Your own recordings whose transcript is ready but not yet reviewed; only these surface during play. */
export function recordingsToReview<T extends { member_id: string; transcript: string | null; reviewed_text: string | null }>(recordings: readonly T[], selfId: string): T[] {
    return recordings.filter((recording) => recording.member_id === selfId && !recording.reviewed_text && Boolean(recording.transcript?.trim()))
}
