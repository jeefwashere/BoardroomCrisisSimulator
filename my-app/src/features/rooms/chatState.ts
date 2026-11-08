import { RoomApiError } from '../../services/rooms.ts'
import type { Contribution, ContributionInput, Recording, RoomApi } from '../../services/rooms.ts'
import { pollRoom } from './roomState.ts'

// History is append only. An older GET must never erase a POST receipt.
export function mergeContributions(current: Contribution[], incoming: Contribution[]): Contribution[] {
    const records = new Map(current.map((entry) => [entry.contribution_id, entry]))
    for (const entry of incoming) records.set(entry.contribution_id, entry)
    return [...records.values()].sort((a, b) => a.sequence - b.sequence || a.contribution_id.localeCompare(b.contribution_id))
}

export function mergeRecordings(current: Recording[], incoming: Recording[]): Recording[] {
    const records = new Map(current.map((entry) => [entry.recording_id, entry]))
    for (const entry of incoming) records.set(entry.recording_id, entry)
    return [...records.values()].sort((a, b) => (a.started_at ?? a.ended_at ?? '').localeCompare(b.started_at ?? b.ended_at ?? '') || a.recording_id.localeCompare(b.recording_id))
}

export type RoomChatEntry = { id: string; member_id: string; kind: 'chat' | 'answer' | 'speech'; phase: string; round_number: number | null; at: string; text: string; source?: string; role_id?: string | null }
export function visibleRoomChatEntries(contributions: Contribution[], recordings: Recording[]): RoomChatEntry[] {
    const messages: RoomChatEntry[] = contributions
        .filter((entry) => !(entry.phase === 'individual_decision' && entry.kind === 'answer'))
        .map((entry) => ({ id: entry.contribution_id, member_id: entry.member_id, kind: entry.kind, phase: entry.phase, round_number: entry.round_number, at: entry.at, text: entry.text, source: entry.source, role_id: entry.role_id }))
    const speech: RoomChatEntry[] = recordings.flatMap((entry) => {
        const text = entry.status === 'reviewed' ? entry.reviewed_text : entry.status === 'review_required' ? entry.transcript : null
        if (!text?.trim()) return []
        return [{ id: entry.recording_id, member_id: entry.member_id, kind: 'speech', phase: 'speech', round_number: entry.round_number, at: entry.started_at ?? entry.ended_at ?? '', text, source: entry.status === 'reviewed' ? 'Reviewed speech transcript' : 'Unreviewed speech transcript' }]
    })
    return [...messages, ...speech].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}

export function chatTextProblem(text: string): string | null {
    if (!text.trim()) return 'Write a message before sending.'
    if (Array.from(text).length > 4000) return 'Messages can contain up to 4,000 characters.'
    return null
}

type ChatState = {
    records: Contribution[]
    recordings: Recording[]
    draft: string
    sending: boolean
    error: string
    historyError: string
    loaded: boolean
    retry: ContributionInput | null
}

type Options = {
    api: Pick<RoomApi, 'contributions' | 'contribute'> & Partial<Pick<RoomApi, 'recordings'>>
    roomId: string
    randomId?: () => string
    refreshRoom: () => Promise<void>
}

export function createChatStore({ api, roomId, randomId = () => crypto.randomUUID(), refreshRoom }: Options) {
    let state: ChatState = { records: [], recordings: [], draft: '', sending: false, error: '', historyError: '', loaded: false, retry: null }
    const listeners = new Set<() => void>()
    let active = true
    let request: AbortController | null = null
    let stopPolling: (() => void) | undefined
    const update = (change: Partial<ChatState>) => {
        if (!active) return
        state = { ...state, ...change }
        listeners.forEach((listener) => listener())
    }
    const receive = (entries: Contribution[], recordings: Recording[] = []) => update({ records: mergeContributions(state.records, entries), recordings: mergeRecordings(state.recordings, recordings), historyError: '', loaded: true })

    async function post(intent: ContributionInput) {
        if (!active || request) return
        const controller = new AbortController()
        request = controller
        update({ sending: true, error: '' })
        try {
            const entry = await api.contribute(roomId, intent, controller.signal)
            if (!active || controller.signal.aborted) return
            receive([entry])
            update({ retry: null, draft: state.draft === intent.text ? '' : state.draft })
        } catch (failure) {
            if (!active || controller.signal.aborted) return
            const definitive = failure instanceof RoomApiError && failure.status !== null && failure.status >= 400 && failure.status < 500
            update({ retry: definitive ? null : intent, error: failure instanceof Error ? failure.message : 'The message could not be confirmed.' })
            if (failure instanceof RoomApiError && failure.code === 'stale_phase') {
                update({ error: 'The room phase changed. Your text is saved. Review it and send again when the room updates.' })
                try { await refreshRoom() } catch { /* The room poll will recover; preserve the draft. */ }
            }
        } finally {
            request = null
            update({ sending: false })
        }
    }

    return {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        setDraft: (draft: string) => update({ draft, error: '' }),
        async send(phaseId: string | null, ended = false) {
            if (request || ended) return
            const problem = chatTextProblem(state.draft)
            if (problem) { update({ error: problem }); return }
            // A retry after a lost response keeps the original body, even across Start.
            const intent = state.retry?.text === state.draft ? state.retry : {
                command_id: randomId(), phase_id: phaseId, kind: 'chat' as const, source: 'typed' as const, text: state.draft,
            }
            await post(intent)
        },
        async retry() { if (state.retry) await post(state.retry) },
        start(subscribeResume?: (resume: () => void) => () => void) {
            active = true
            stopPolling = pollRoom(async (signal) => ({ contributions: await api.contributions(roomId, signal), recordings: api.recordings ? await api.recordings(roomId, signal) : [] }),
                (history) => receive(history.contributions, history.recordings),
                (failure) => update({ historyError: failure instanceof Error ? failure.message : 'History could not be refreshed.' }), 2000, subscribeResume)
            return () => { active = false; stopPolling?.(); request?.abort() }
        },
    }
}
