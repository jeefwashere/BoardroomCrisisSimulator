import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import type { RoomSnapshot } from '../../services/rooms'
import { facilitationApi } from '../facilitation/facilitationClient'
import { assignSavedClips, clipForMember, isOwnTurn, turnKey } from './savedClips'

type Execute = (path: string, fields?: Record<string, unknown>) => Promise<void>

export type AutoResponseState = 'unavailable' | 'ready' | 'playing' | 'saving' | 'done'

/**
 * "Auto response" for the caller's speaking turn: plays the caller's prerecorded demo clip,
 * shows its caption as subtitles, then commits the exact caption and passes the turn.
 */
export function useAutoResponse(room: RoomSnapshot, execute: Execute, onError: (failure: unknown) => void) {
    const game = room.game
    const finishPath = `rounds/${game?.round_id ?? ''}/speaker/finish`
    async function act(path: string, fields?: Record<string, unknown>) {
        try { await execute(path, fields); return true } catch (failure) { onError(failure); return false }
    }
    const [catalog, setCatalog] = useState<RecordedClip[]>([])
    const [state, setState] = useState<{ turn: string | null; status: AutoResponseState }>({ turn: null, status: 'ready' })
    const audio = useRef<HTMLAudioElement | null>(null)
    const latestTurn = useRef<string | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        facilitationApi.recordings(controller.signal).then((clips) => setCatalog(Array.isArray(clips) ? clips : [])).catch(() => setCatalog([]))
        return () => controller.abort()
    }, [])

    const view = { phase: room.phase, phaseId: game?.phase_id ?? '', activeSpeakerId: game?.active_speaker_id, selfId: room.self_member_id }
    const turn = turnKey(view)
    const ownTurn = isOwnTurn(view)
    const eligible = game?.eligible_member_ids
    const clip = useMemo(() => clipForMember(assignSavedClips(eligible ?? [], catalog), room.self_member_id), [eligible, catalog, room.self_member_id])

    useEffect(() => {
        latestTurn.current = turn
        // A turn change (skip, timeout) stops any clip still playing for the old turn.
        return () => { audio.current?.pause(); audio.current = null }
    }, [turn])

    const status: AutoResponseState = !ownTurn || !clip ? 'unavailable' : state.turn === turn ? state.status : 'ready'

    async function commit(forTurn: string, caption: string) {
        if (latestTurn.current !== forTurn) return
        setState({ turn: forTurn, status: 'saving' })
        const saved = await act('contributions', { kind: 'answer', source: 'typed', text: caption })
        if (saved && latestTurn.current === forTurn) await act(finishPath)
        setState({ turn: forTurn, status: saved ? 'done' : 'ready' })
    }

    function start() {
        if (!clip || !turn || status !== 'ready') return
        const forTurn = turn
        const player = new Audio(facilitationApi.recordingUrl(clip))
        audio.current = player
        setState({ turn: forTurn, status: 'playing' })
        player.onended = () => { if (audio.current === player) void commit(forTurn, clip.text) }
        // If the browser refuses playback, still commit the caption so the turn moves on.
        player.play().catch(() => { if (audio.current === player) void commit(forTurn, clip.text) })
    }

    function stop() {
        audio.current?.pause(); audio.current = null
        if (turn) setState({ turn, status: 'ready' })
    }

    return { status, caption: clip?.text ?? '', start, stop }
}
