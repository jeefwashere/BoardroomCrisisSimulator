import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { RoomSnapshot } from '../../services/rooms'
import { roomApi, errorMessage } from '../rooms/useRoom'
import { DiscussionDraft, draftKey, initialDraft } from './discussionDraftModel'
import { appendTranscript } from './dictationModel'

function storage() { try { return window.sessionStorage } catch { return null } }

export function useDiscussionDraft(room: RoomSnapshot) {
    const key = draftKey(room)
    const controller = useMemo(() => {
        const saved = storage()
        let raw: string | null = null
        try { raw = saved?.getItem(key) ?? null } catch { /* Typing still works without storage. */ }
        return new DiscussionDraft(initialDraft(raw, room.game?.individual_decisions?.self?.text ?? null), (value) => {
            try { if (!saved) return false; saved.setItem(key, value); return true } catch { return false }
        })
        // A phase change deliberately retains this round's editor.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
    const append = useCallback((words: string) => controller.edit(appendTranscript(controller.getSnapshot().text, words)), [controller])
    const eligible = room.game?.eligible_member_ids.includes(room.self_member_id) ?? false
    const active = room.game?.decision_mode === 'individual' && eligible && ['speaking', 'discussion', 'individual_decision'].includes(room.phase)
    const roundId = room.game?.round_id ?? ''
    const roomId = room.room_id
    const memberId = room.self_member_id
    const request = useMemo(() => ({ owner: controller, pending: false, commandId: crypto.randomUUID(), abort: null as AbortController | null }), [controller])
    const refresh = useCallback(async (retry = false, signal?: AbortSignal) => {
        if (!active || request.pending) return
        request.pending = true
        const abort = new AbortController()
        request.abort = abort
        const cancel = () => abort.abort()
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) abort.abort()
        try {
            const result = await roomApi.discussionSummary(roomId, { command_id: retry ? crypto.randomUUID() : request.commandId, round_id: roundId, retry }, abort.signal)
            if (!abort.signal.aborted && result.member_id === memberId && result.round_id === roundId) controller.receive(result)
        } catch (error) { if (!abort.signal.aborted) controller.failed(errorMessage(error)) }
        finally { request.pending = false; signal?.removeEventListener('abort', cancel) }
    }, [controller, roomId, roundId, memberId, request, active])
    useEffect(() => {
        if (!active) return
        const abort = new AbortController()
        let timer: ReturnType<typeof setTimeout>
        async function poll() {
            await refresh(false, abort.signal)
            if (!abort.signal.aborted) timer = setTimeout(poll, 2000)
        }
        void poll()
        return () => { abort.abort(); request.abort?.abort(); clearTimeout(timer) }
    }, [active, refresh, request])
    return { state, edit: controller.edit, append, accept: controller.accept, submitted: controller.submitted, retry: () => refresh(true), active }
}
export type DiscussionDraftHandle = ReturnType<typeof useDiscussionDraft>
