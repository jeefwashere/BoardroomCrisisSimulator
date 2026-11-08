// Pure helpers for the expert panel stage (no JSX, no network) so they can be unit tested.
import type { Adviser, ExpertKind, ExpertPanel, ExpertTake, PanelExpertKind } from '../../services/facilitation.ts'

/** Legacy panel (vote mode scenarios). */
export const EXPERT_ORDER: readonly ExpertKind[] = ['facilitator', 'it', 'journalist']
/** Panel used by individual decision scenarios such as Cedar T01. */
export const PANEL_EXPERT_ORDER: readonly PanelExpertKind[] = ['security', 'operations', 'governance']

const DEFAULT_LABELS: Record<ExpertKind, string> = {
    facilitator: 'Facilitator', it: 'IT adviser', journalist: 'Journalist',
    security: 'IT and security', operations: 'Operations and community services', governance: 'Governance and finance',
}

const DEFAULT_PERSONAS: Record<ExpertKind, string> = {
    facilitator: 'Neutral meeting coach: clarifies assumptions and trade offs.',
    it: 'Technical recovery: dependencies, backups and what must be verified.',
    journalist: 'Outside pressure: what can be said publicly, facts versus unknowns.',
    security: 'Systems and security: backups, exposure and what must be verified before restoring.',
    operations: 'Front line services: who is affected today, workarounds and staffing.',
    governance: 'Authority and money: who can decide, what must be recorded and what it costs.',
}

export const EXPERT_ACCENTS: Record<ExpertKind, string> = {
    facilitator: '#354c3c', it: '#3d5a80', journalist: '#ae5238',
    security: '#3d5a80', operations: '#8a6a2c', governance: '#6b4c7a',
}

const EXPERT_INITIALS: Partial<Record<ExpertKind, string>> = { security: 'IS', operations: 'OC', governance: 'GF' }

function known(kind: string): kind is ExpertKind {
    return Object.hasOwn(DEFAULT_LABELS, kind)
}

export function expertAccent(kind: string): string {
    return known(kind) ? EXPERT_ACCENTS[kind] : '#5b5f57'
}

/** Two letter avatar text: fixed for the panel experts, else the first letters of the label's first two words. */
export function expertInitials(kind: string, label: string): string {
    const fixed = known(kind) ? EXPERT_INITIALS[kind] : undefined
    if (fixed) return fixed
    const words = label.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return '?'
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
    return (words[0][0] + words[1][0]).toUpperCase()
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

function placeholder(kind: ExpertKind): ExpertTake {
    return { kind, label: DEFAULT_LABELS[kind], status: 'pending', text: '', source: null, speech_id: null, error: null }
}

/**
 * The fixed order to show: the newer panel when any take uses its kinds, the legacy panel when any take
 * uses legacy kinds, else `fallback` (used before the panel arrives).
 */
export function expertOrder(panel: ExpertPanel | null | undefined, fallback: readonly ExpertKind[] = EXPERT_ORDER): readonly ExpertKind[] {
    const kinds = (panel?.experts ?? []).map((take) => take.kind as string)
    if (kinds.some((kind) => (PANEL_EXPERT_ORDER as readonly string[]).includes(kind))) return PANEL_EXPERT_ORDER
    if (kinds.some((kind) => (EXPERT_ORDER as readonly string[]).includes(kind))) return EXPERT_ORDER
    return fallback
}

/** Always three takes in the fixed order (plus any unknown kinds after them); missing experts are shown as still preparing. */
export function normalizeExperts(panel: ExpertPanel | null | undefined, fallback: readonly ExpertKind[] = EXPERT_ORDER): ExpertTake[] {
    const experts = panel?.experts ?? []
    const order = expertOrder(panel, fallback)
    const fixed = order.map((kind) => {
        const take = experts.find((item) => item.kind === kind)
        return take ? { ...take, label: take.label || DEFAULT_LABELS[kind], text: take.text ?? '' } : placeholder(kind)
    })
    const extra = experts.filter((take) => !order.includes(take.kind)).map((take) => ({ ...take, label: take.label || String(take.kind), text: take.text ?? '' }))
    return [...fixed, ...extra]
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

export function expertPersona(kind: string, advisers: readonly Adviser[] = []): string {
    return advisers.find((adviser) => adviser.kind === kind)?.description || (known(kind) ? DEFAULT_PERSONAS[kind] : '')
}

/** Footer label describing where the takes came from. Empty until at least one take is ready. */
export function panelSourceLabel(experts: readonly ExpertTake[]): string {
    const sources = experts.filter((take) => take.status === 'ready').map((take) => take.source)
    if (sources.includes('vertex')) return sources.includes('offline') ? 'Live Gemini (Vertex AI) · voiced by ElevenLabs · some replies offline' : 'Live Gemini (Vertex AI) · voiced by ElevenLabs'
    if (sources.includes('hosted')) return 'AI reply'
    if (sources.includes('offline')) return 'Offline reply'
    return ''
}
