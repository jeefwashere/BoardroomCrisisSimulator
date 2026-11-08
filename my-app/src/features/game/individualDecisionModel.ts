// Pure helpers for the individual decision step (no JSX, no network) so they can be unit tested.
import type { IndividualDecisions, RoomGame } from '../../services/rooms.ts'

export const DECISION_PROMPT = 'I would… because… using… I still need to establish…'
export const DECISION_LIMIT = 2000

export function isIndividualMode(game: Pick<RoomGame, 'decision_mode'> | null | undefined): boolean {
    return game?.decision_mode === 'individual'
}

/** A decision can be submitted when it has text within the limit and differs from what is already recorded. */
export function canSubmitDecision(text: string, recorded?: string | null): boolean {
    const clean = text.trim()
    return clean.length > 0 && clean.length <= DECISION_LIMIT && clean !== (recorded ?? '').trim()
}

export type BoardRow = { member_id: string; name: string; role: string; submitted: boolean; self: boolean }

/** Who has submitted, in server order. The caller's own row also counts as submitted once their decision is recorded. */
export function boardRows(decisions: IndividualDecisions | null | undefined, selfId: string): BoardRow[] {
    const ownRecorded = Boolean(decisions?.self)
    return (decisions?.submitted ?? []).map((item) => {
        const self = item.member_id === selfId
        return { member_id: item.member_id, name: item.display_name, role: item.role_name, submitted: item.submitted || (self && ownRecorded), self }
    })
}

export function submittedCount(rows: readonly BoardRow[]): { done: number; total: number } {
    return { done: rows.filter((row) => row.submitted).length, total: rows.length }
}

function names(list: readonly string[]): string {
    return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** One line on who the round is waiting for, the caller included ("you"). */
export function waitingSummary(rows: readonly BoardRow[]): string {
    if (!rows.length) return ''
    const pending = rows.filter((row) => !row.submitted)
    const done = rows.filter((row) => row.submitted && !row.self).map((row) => row.name)
    if (!pending.length) return 'All decisions are in. Waiting for decisions to close.'
    const waiting = names(pending.map((row) => row.self ? 'you' : row.name))
    const selfDone = rows.some((row) => row.self && row.submitted)
    const lead = selfDone ? `Your decision is in. Waiting for ${waiting}` : `Waiting for ${waiting}`
    return done.length ? `${lead} · ${names(done)} ${done.length === 1 ? 'has' : 'have'} submitted` : lead
}

const ROUND_ONE_PHASES = ['briefing', 'reading', 'speaking', 'discussion', 'individual_decision']

/** Small header label for individual decision games; null in vote mode or once the game has ended. */
export function roundLabel(phase: string, game: Pick<RoomGame, 'decision_mode'> | null | undefined): string | null {
    if (!isIndividualMode(game)) return null
    return ROUND_ONE_PHASES.includes(phase) ? 'Round 1 · Board discussion' : null
}

export type DecisionBadge = { label: string; tone: 'decide' | 'voted' }

/** Call tile badges during the decision step: Submitted or Writing… for every listed board member. */
export function decisionBadges(decisions: IndividualDecisions | null | undefined, selfId: string): Record<string, DecisionBadge> {
    const badges: Record<string, DecisionBadge> = {}
    for (const row of boardRows(decisions, selfId)) badges[row.member_id] = row.submitted ? { label: 'Submitted', tone: 'voted' } : { label: 'Deciding…', tone: 'decide' }
    if (!badges[selfId] && decisions) badges[selfId] = decisions.self ? { label: 'Submitted', tone: 'voted' } : { label: 'Decide now', tone: 'decide' }
    return badges
}

/** Ended report heading from the server's ending label (an identifier or a sentence). */
export function endingTitle(label: string | null | undefined): string {
    const text = (label ?? '').replaceAll('_', ' ').trim()
    return text ? text[0].toUpperCase() + text.slice(1) : 'Individual decisions recorded'
}
