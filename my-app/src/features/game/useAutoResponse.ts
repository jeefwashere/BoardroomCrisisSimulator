import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import type { RoomSnapshot } from '../../services/rooms'
import { facilitationApi } from '../facilitation/facilitationClient'
import { clipForTurn, isOwnTurn, turnKey } from './savedClips'

type Execute = (path: string, fields?: Record<string, unknown>) => Promise<void>

export type AutoResponseState = 'unavailable' | 'ready' | 'playing' | 'saving' | 'done'

/** The clip actually playing: its key (turn or question) and audio length, known once playback starts. */
export type AutoPlayback = { key: string; durationMs: number | null }

export function audioDurationMs(audio: HTMLAudioElement): number | null {
    return Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : null
}

/** How far into its audio an element is, so a resumed line keeps its caption in step. */
export function audioElapsedMs(audio: HTMLAudioElement): number {
    return Number.isFinite(audio.currentTime) ? Math.round(audio.currentTime * 1000) : 0
}

/**
 * "Auto response" for the caller's speaking turn: plays the caller's prerecorded demo clip for this turn,
 * then commits the exact caption and passes the turn. With untimed turns it also tells the other windows to play
 * the clip, and leaves passing the turn to the speaker's Finish my turn button. Its caption goes to the live transcript, never onto the call.
 */
export function useAutoResponse(room: RoomSnapshot, execute: Execute, onError: (failure: unknown) => void) {
    const game = room.game
    const finishPath = `rounds/${game?.round_id ?? ''}/speaker/finish`
    const clipPath = `rounds/${game?.round_id ?? ''}/speaker/clip`
    // Untimed turns (three window demo): the clip is shared with the other windows and the turn waits for Finish my turn.
    const manual = Boolean(game?.manual_turns)
    async function act(path: string, fields?: Record<string, unknown>) {
        try { await execute(path, fields); return true } catch (failure) { onError(failure); return false }
    }
    const [catalog, setCatalog] = useState<RecordedClip[]>([])
    const [state, setState] = useState<{ turn: string | null; status: AutoResponseState }>({ turn: null, status: 'ready' })
    const [playback, setPlayback] = useState<AutoPlayback | null>(null)
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
    const clip = useMemo(() => clipForTurn(game, catalog, room.self_member_id), [game, catalog, room.self_member_id])

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
        if (saved && !manual && latestTurn.current === forTurn) await act(finishPath)
        setState({ turn: forTurn, status: saved ? 'done' : 'ready' })
    }

    function start() {
        if (!clip || !turn || status !== 'ready') return
        const forTurn = turn
        const player = new Audio(facilitationApi.recordingUrl(clip))
        audio.current = player
        setState({ turn: forTurn, status: 'playing' })
        if (manual) void act(clipPath, { clip_id: clip.clip_id })
        player.addEventListener('playing', () => { if (audio.current === player) setPlayback({ key: forTurn, durationMs: audioDurationMs(player) }) }, { once: true })
        player.onended = () => { if (audio.current === player) void commit(forTurn, clip.text) }
        // If the browser refuses playback, still commit the caption so the turn moves on.
        player.play().catch(() => { if (audio.current === player) void commit(forTurn, clip.text) })
    }

    function stop() {
        audio.current?.pause(); audio.current = null
        if (manual) void act(clipPath, { clip_id: null })
        if (turn) setState({ turn, status: 'ready' })
    }

    return {
        status,
        caption: clip?.text ?? '',
        /** The turn this response belongs to (null outside the caller's speaking turn). */
        turn: ownTurn ? turn : null,
        playback: status === 'playing' && playback?.key === turn ? playback : null,
        catalog,
        start,
        stop,
    }
}
