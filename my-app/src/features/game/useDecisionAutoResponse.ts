import { useEffect, useRef, useState } from 'react'
import type { RoomSnapshot } from '../../services/rooms'
import { facilitationApi } from '../facilitation/facilitationClient'
import { streamedSpeech } from './aiReply'
import { audioDurationMs } from './useAutoResponse'
import type { AutoPlayback, AutoResponseState } from './useAutoResponse'

/**
 * "AI reply" during the Round 1 individual decision: Vertex writes this member's decision for their role from what the
 * board said, it is spoken in their role voice in this window only (decisions are private), then saved as their
 * decision. Mirrors `usePrivateAutoResponse`. The member can still type or dictate their own decision in Chat instead.
 */
export function useDecisionAutoResponse(room: RoomSnapshot, submit: (text: string) => Promise<boolean>, onError: (failure: unknown) => void) {
    const game = room.game
    const deciding = room.phase === 'individual_decision' && Boolean(game?.allowed_actions?.includes('submit_decision'))
    const key = deciding && game ? game.phase_id : null
    const [state, setState] = useState<{ key: string | null; status: AutoResponseState }>({ key: null, status: 'ready' })
    const [reply, setReply] = useState<{ key: string; text: string } | null>(null)
    const [playback, setPlayback] = useState<AutoPlayback | null>(null)
    const audio = useRef<HTMLAudioElement | null>(null)
    const disposeSpeech = useRef<(() => void) | null>(null)
    const latestKey = useRef<string | null>(null)

    function release() {
        audio.current?.pause(); audio.current = null
        disposeSpeech.current?.(); disposeSpeech.current = null
    }

    useEffect(() => {
        latestKey.current = key
        // Decisions closing (or a new round) stops a reply still playing.
        return release
    }, [key])

    // After a saved decision the button reads "Reply sent"; it can be pressed again to replace the decision.
    const raw: AutoResponseState = !key ? 'unavailable' : state.key === key ? state.status : 'ready'

    async function commit(forKey: string, text: string) {
        if (latestKey.current !== forKey) return
        setState({ key: forKey, status: 'saving' })
        const saved = await submit(text)
        setState({ key: forKey, status: saved ? 'done' : 'ready' })
    }

    async function start() {
        if (!key || (raw !== 'ready' && raw !== 'done')) return
        const forKey = key
        setState({ key: forKey, status: 'writing' })
        let drafted
        try { drafted = await facilitationApi.reply(room.room_id, { mode: 'decision' }) }
        catch (failure) { onError(failure); if (latestKey.current === forKey) setState({ key: forKey, status: 'ready' }); return }
        if (latestKey.current !== forKey) return
        setReply({ key: forKey, text: drafted.text })
        const speech = await streamedSpeech(room.room_id, drafted.speech_id)
        if (latestKey.current !== forKey) { speech?.dispose(); return }
        if (!speech) { await commit(forKey, drafted.text); return }
        release()
        disposeSpeech.current = speech.dispose
        const player = speech.player
        audio.current = player
        setState({ key: forKey, status: 'playing' })
        player.addEventListener('playing', () => { if (audio.current === player) setPlayback({ key: forKey, durationMs: audioDurationMs(player) }) }, { once: true })
        const finish = () => { if (audio.current === player) { release(); void commit(forKey, drafted.text) } }
        player.onended = finish
        // A broken stream still saves the written decision.
        player.onerror = finish
        player.play().catch(finish)
    }

    function stop() {
        // Stopping the voice early still keeps the written decision.
        const text = reply && reply.key === key ? reply.text : ''
        release()
        if (key && text) void commit(key, text)
        else if (key) setState({ key, status: 'ready' })
    }

    return {
        status: raw === 'done' ? 'ready' as AutoResponseState : raw, saved: raw === 'done',
        caption: reply && reply.key === key ? reply.text : '', key, playback: raw === 'playing' && playback?.key === key ? playback : null,
        start: () => void start(), stop,
    }
}
