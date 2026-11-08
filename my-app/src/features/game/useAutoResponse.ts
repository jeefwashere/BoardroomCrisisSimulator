import { useEffect, useRef, useState } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import type { RoomSnapshot } from '../../services/rooms'
import { facilitationApi } from '../facilitation/facilitationClient'
import { REPLY_CLIP_PREFIX, streamedSpeech } from './aiReply'
import { isOwnTurn, turnKey } from './savedClips'

type Execute = (path: string, fields?: Record<string, unknown>) => Promise<void>

export type AutoResponseState = 'unavailable' | 'ready' | 'writing' | 'playing' | 'saving' | 'done'

/** The reply actually playing: its key (turn or question) and audio length, known once playback starts. */
export type AutoPlayback = { key: string; durationMs: number | null }

export function audioDurationMs(audio: HTMLAudioElement): number | null {
    return Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : null
}

/** How far into its audio an element is, so a resumed line keeps its caption in step. */
export function audioElapsedMs(audio: HTMLAudioElement): number {
    return Number.isFinite(audio.currentTime) ? Math.round(audio.currentTime * 1000) : 0
}

/**
 * "AI reply" for the caller's speaking turn: Vertex writes a first person reply for the caller's role from what the
 * board has said, ElevenLabs speaks it in the role's voice, then its exact caption is committed as the caller's
 * answer. With untimed turns (three window demo) the reply also plays in the other windows, and passing the turn is
 * left to Finish my turn; otherwise the turn passes when it ends. The caption goes to the live transcript.
 */
export function useAutoResponse(room: RoomSnapshot, execute: Execute, onError: (failure: unknown) => void) {
    const game = room.game
    const finishPath = `rounds/${game?.round_id ?? ''}/speaker/finish`
    const clipPath = `rounds/${game?.round_id ?? ''}/speaker/clip`
    const claimPath = `rounds/${game?.round_id ?? ''}/speaker/claim`
    // Open floor rooms: pressing AI reply while the floor is free takes it first, then writes the reply.
    const canClaim = room.phase === 'speaking' && Boolean(game?.allowed_actions?.includes('take_floor'))
    const claiming = useRef(false)
    const manual = Boolean(game?.manual_turns)
    async function act(path: string, fields?: Record<string, unknown>) {
        try { await execute(path, fields); return true } catch (failure) { onError(failure); return false }
    }
    // Saved clips remain for the solo demo's bots and older rooms; players no longer use them.
    const [catalog, setCatalog] = useState<RecordedClip[]>([])
    const [state, setState] = useState<{ turn: string | null; status: AutoResponseState }>({ turn: null, status: 'ready' })
    const [reply, setReply] = useState<{ turn: string; text: string } | null>(null)
    const [playback, setPlayback] = useState<AutoPlayback | null>(null)
    const audio = useRef<HTMLAudioElement | null>(null)
    const disposeSpeech = useRef<(() => void) | null>(null)
    const latestTurn = useRef<string | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        facilitationApi.recordings(controller.signal).then((clips) => setCatalog(Array.isArray(clips) ? clips : [])).catch(() => setCatalog([]))
        return () => controller.abort()
    }, [])

    const view = { phase: room.phase, phaseId: game?.phase_id ?? '', activeSpeakerId: game?.active_speaker_id, selfId: room.self_member_id }
    const turn = turnKey(view)
    const ownTurn = isOwnTurn(view)

    function release() {
        audio.current?.pause(); audio.current = null
        disposeSpeech.current?.(); disposeSpeech.current = null
    }

    useEffect(() => {
        latestTurn.current = turn
        // A turn change (skip, timeout) stops any reply still playing for the old turn.
        return release
    }, [turn])

    const status: AutoResponseState = !ownTurn ? (canClaim ? 'ready' : 'unavailable') : state.turn === turn ? state.status : 'ready'

    async function commit(forTurn: string, caption: string) {
        if (latestTurn.current !== forTurn) return
        setState({ turn: forTurn, status: 'saving' })
        const saved = await act('contributions', { kind: 'answer', source: 'typed', text: caption })
        if (saved && !manual && latestTurn.current === forTurn) await act(finishPath)
        setState({ turn: forTurn, status: saved ? 'done' : 'ready' })
    }

    async function start() {
        if (!ownTurn && canClaim) {
            // The reply starts once the room shows the caller holding the floor (effect below).
            if (claiming.current) return
            claiming.current = true
            if (!(await act(claimPath))) claiming.current = false
            return
        }
        if (!turn || status !== 'ready') return
        const forTurn = turn
        setState({ turn: forTurn, status: 'writing' })
        let drafted
        try { drafted = await facilitationApi.reply(room.room_id, { mode: 'turn' }) }
        catch (failure) { onError(failure); if (latestTurn.current === forTurn) setState({ turn: forTurn, status: 'ready' }); return }
        if (latestTurn.current !== forTurn) return
        setReply({ turn: forTurn, text: drafted.text })
        // Streams: playback starts with the first audio instead of after the whole file.
        const speech = await streamedSpeech(room.room_id, drafted.speech_id)
        if (latestTurn.current !== forTurn) { speech?.dispose(); return }
        // Without audio (speech off or failed) the written reply is still used.
        if (!speech) { await commit(forTurn, drafted.text); return }
        release()
        disposeSpeech.current = speech.dispose
        const player = speech.player
        audio.current = player
        setState({ turn: forTurn, status: 'playing' })
        if (manual) void act(clipPath, { clip_id: `${REPLY_CLIP_PREFIX}${drafted.speech_id}`, text: drafted.text })
        player.addEventListener('playing', () => { if (audio.current === player) setPlayback({ key: forTurn, durationMs: audioDurationMs(player) }) }, { once: true })
        player.onended = () => { if (audio.current === player) { release(); void commit(forTurn, drafted.text) } }
        // A broken stream still commits the written reply.
        player.onerror = () => { if (audio.current === player) { release(); void commit(forTurn, drafted.text) } }
        // If the browser refuses playback, still commit the caption so the turn can move on.
        player.play().catch(() => { if (audio.current === player) { release(); void commit(forTurn, drafted.text) } })
    }

    useEffect(() => {
        if (claiming.current && ownTurn) { claiming.current = false; void start() }
        else if (claiming.current && room.phase !== 'speaking') claiming.current = false
    })

    function stop() {
        release()
        if (manual) void act(clipPath, { clip_id: null })
        if (turn) setState({ turn, status: 'ready' })
    }

    return {
        status,
        caption: reply && reply.turn === turn ? reply.text : '',
        /** The turn this reply belongs to (null outside the caller's speaking turn). */
        turn: ownTurn ? turn : null,
        playback: status === 'playing' && playback?.key === turn ? playback : null,
        catalog,
        start: () => void start(),
        stop,
    }
}
