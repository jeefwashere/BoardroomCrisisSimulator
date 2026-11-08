import type { DiscussionSummary, RoomSnapshot } from '../../services/rooms.ts'
import { DECISION_LIMIT } from './individualDecisionModel.ts'

export type DiscussionDraftState = {
    text: string
    mode: 'automatic' | 'manual'
    revision: number
    evidenceRevision: string
    generatedText: string | null
    suggestion: DiscussionSummary | null
    status: DiscussionSummary['status']
    source: string | null
    error: string | null
    submittedText: string | null
    storageAvailable: boolean
}
export function draftKey(room: RoomSnapshot): string {
    return JSON.stringify(['discussion-draft', room.room_id, room.game?.started_at, room.game?.round_id, room.self_member_id])
}
export function initialDraft(raw: string | null, recorded: string | null = null): DiscussionDraftState {
    const initial: DiscussionDraftState = { text: recorded ?? '', mode: recorded ? 'manual' : 'automatic', revision: 0, evidenceRevision: '', generatedText: null, suggestion: null, status: 'empty', source: null, error: null, submittedText: recorded, storageAvailable: true }
    if (!raw) return initial
    try {
        const saved = JSON.parse(raw)
        if (saved.version !== 1 || typeof saved.text !== 'string' || saved.text.length > DECISION_LIMIT || !['automatic', 'manual'].includes(saved.mode)) return initial
        return { ...initial, text: saved.text, mode: saved.mode, submittedText: recorded ?? (typeof saved.submittedText === 'string' ? saved.submittedText : null) }
    } catch { return initial }
}
export function serializeDraft(state: DiscussionDraftState): string {
    return JSON.stringify({ version: 1, text: state.text, mode: state.mode, evidenceRevision: state.evidenceRevision, submittedText: state.submittedText })
}

/** Sole editor writer. Generated text never changes a field after its first human edit. */
export class DiscussionDraft {
    private state: DiscussionDraftState
    private listeners = new Set<() => void>()
    private readonly persist: (raw: string) => boolean
    constructor(initial: DiscussionDraftState, persist: (raw: string) => boolean) { this.state = initial; this.persist = persist }
    getSnapshot = () => this.state
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
    private update(patch: Partial<DiscussionDraftState>) {
        const next = { ...this.state, ...patch }
        next.storageAvailable = this.persist(serializeDraft(next))
        this.state = next
        this.listeners.forEach((listener) => listener())
    }
    edit = (text: string) => this.update({ text: text.slice(0, DECISION_LIMIT), mode: 'manual', revision: this.state.revision + 1 })
    accept = () => {
        if (this.state.suggestion?.text) this.update({ text: this.state.suggestion.text, mode: 'manual', revision: this.state.revision + 1, suggestion: null })
    }
    submitted = (text: string) => this.update({ submittedText: text, mode: 'manual' })
    failed = (message: string) => this.update({ status: 'failed', error: message })
    receive = (result: DiscussionSummary) => {
        const patch: Partial<DiscussionDraftState> = { status: result.status, error: result.error, source: result.source }
        if (result.evidence_revision !== this.state.evidenceRevision) patch.suggestion = null
        if (result.status === 'ready' && result.text && (result.evidence_revision !== this.state.evidenceRevision || result.text !== this.state.generatedText)) {
            if (this.state.mode === 'automatic' && this.state.submittedText === null) patch.text = result.text
            else if (result.text !== this.state.text) patch.suggestion = result
        }
        if (result.status === 'ready') { patch.evidenceRevision = result.evidence_revision; patch.generatedText = result.text }
        this.update(patch)
    }
}
