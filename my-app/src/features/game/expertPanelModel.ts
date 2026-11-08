// Pure helpers for the expert panel stage (no JSX, no network) so they can be unit tested.
import type { Adviser, AdviserKind, ExpertPanel, ExpertTake } from '../../services/facilitation.ts'

export const EXPERT_ORDER: readonly AdviserKind[] = ['facilitator', 'it', 'journalist']

const DEFAULT_LABELS: Record<AdviserKind, string> = { facilitator: 'Facilitator', it: 'IT adviser', journalist: 'Journalist' }

const DEFAULT_PERSONAS: Record<AdviserKind, string> = {
    facilitator: 'Neutral meeting coach: clarifies assumptions and trade offs.',
    it: 'Technical recovery: dependencies, backups and what must be verified.',
    journalist: 'Outside pressure: what can be said publicly, facts versus unknowns.',
}

export type ExpertCardStatus = 'preparing' | 'speaking' | 'up_next' | 'done' | 'unavailable'

export const EXPERT_STATUS_LABELS: Record<ExpertCardStatus, string> = {
    preparing: 'Preparing…',
    speaking: 'Speaking',
    up_next: 'Up next',
    done: 'Done',
    unavailable: 'Unavailable',
}

/** The expert stage replaces the call while the discussion runs in experts mode. */
export function showsExpertStage(phase: string, mode: string | null | undefined): boolean {
    return phase === 'discussion' && mode === 'experts'
}

/** Ignores a panel left over from another round. A panel without a round id is accepted. */
export function panelForRound(panel: ExpertPanel | null | undefined, roundId: string): ExpertPanel | null {
    if (!panel) return null
    return !panel.round_id || panel.round_id === roundId ? panel : null
}

function placeholder(kind: AdviserKind): ExpertTake {
    return { kind, label: DEFAULT_LABELS[kind], status: 'pending', text: '', source: null, speech_id: null, error: null }
}

/** Always three takes in the fixed order; missing experts are shown as still preparing. */
export function normalizeExperts(panel: ExpertPanel | null | undefined): ExpertTake[] {
    const experts = panel?.experts ?? []
    return EXPERT_ORDER.map((kind) => {
        const take = experts.find((item) => item.kind === kind)
        return take ? { ...take, label: take.label || DEFAULT_LABELS[kind], text: take.text ?? '' } : placeholder(kind)
    })
}

/** Polling can stop once the panel is ready and no take is still pending. */
export function panelSettled(panel: ExpertPanel | null | undefined): boolean {
    return !!panel && panel.status === 'ready' && panel.experts.every((take) => take.status !== 'pending')
}

/**
 * Index of the expert who has the floor, given how many turns have finished (`step`).
 * Failed takes are skipped; a pending take holds the floor until it is ready. Returns -1 once every turn is over.
 */
export function activeExpertIndex(experts: readonly ExpertTake[], step: number): number {
    for (let index = Math.max(0, step); index < experts.length; index += 1) {
        if (experts[index].status !== 'failed') return index
    }
    return -1
}

export function expertCardStatus(experts: readonly ExpertTake[], index: number, active: number): ExpertCardStatus {
    const take = experts[index]
    if (!take) return 'unavailable'
    if (take.status === 'failed') return 'unavailable'
    if (active === -1 || index < active) return 'done'
    if (take.status === 'pending') return 'preparing'
    return index === active ? 'speaking' : 'up_next'
}

export function expertPersona(kind: AdviserKind, advisers: readonly Adviser[] = []): string {
    return advisers.find((adviser) => adviser.kind === kind)?.description || DEFAULT_PERSONAS[kind]
}

/** Footer label describing where the takes came from. Empty until at least one take is ready. */
export function panelSourceLabel(experts: readonly ExpertTake[]): string {
    const sources = experts.filter((take) => take.status === 'ready').map((take) => take.source)
    if (sources.includes('vertex')) return sources.includes('offline') ? 'Live Gemini (Vertex AI) · voiced by ElevenLabs · some replies offline' : 'Live Gemini (Vertex AI) · voiced by ElevenLabs'
    if (sources.includes('hosted')) return 'AI reply'
    if (sources.includes('offline')) return 'Offline reply'
    return ''
}
