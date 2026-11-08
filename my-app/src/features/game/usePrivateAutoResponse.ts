import { useEffect, useRef, useState } from 'react'
import type { PrivateSession } from '../../services/facilitation'
import { facilitationApi } from '../facilitation/facilitationClient'
import { audioDurationMs } from './useAutoResponse'
import type { AutoPlayback, AutoResponseState } from './useAutoResponse'

/**
 * "Auto response" during a private session: plays the caller's saved answer clip for the current question with
 * its caption in the live transcript, then submits its exact caption as the answer (`used_clip: true`). Mirrors `useAutoResponse`.
 */
export function usePrivateAutoResponse(session: PrivateSession | null, sending: boolean, answer: (text: string, usedClip: boolean) => Promise<boolean>) {
    const [state, setState] = useState<{ key: string | null; status: AutoResponseState }>({ key: null, status: 'ready' })
    const [playback, setPlayback] = useState<AutoPlayback | null>(null)
    const audio = useRef<HTMLAudioElement | null>(null)
    const latestKey = useRef<string | null>(null)
    const clip = session?.expecting && !session.busy ? session.clip : null
    const key = clip && session?.expecting ? `${session.expecting.round}:${session.expecting.step}:${clip.clip_id}` : null

    useEffect(() => {
        latestKey.current = key
        // A new question (or none) stops any clip still playing for the old one.
        return () => { audio.current?.pause(); audio.current = null }
    }, [key])

    const status: AutoResponseState = !key ? 'unavailable' : state.key === key ? state.status : 'ready'

    async function commit(forKey: string, caption: string) {
        if (latestKey.current !== forKey) return
        audio.current = null
        setState({ key: forKey, status: 'saving' })
        const saved = await answer(caption, true)
        setState({ key: forKey, status: saved ? 'done' : 'ready' })
    }

    function start() {
        if (!clip || !key || status !== 'ready' || sending) return
        const forKey = key
        const player = new Audio(facilitationApi.privateClipUrl(clip))
        audio.current = player
        setState({ key: forKey, status: 'playing' })
        player.addEventListener('playing', () => { if (audio.current === player) setPlayback({ key: forKey, durationMs: audioDurationMs(player) }) }, { once: true })
        player.onended = () => { if (audio.current === player) void commit(forKey, clip.text) }
        // If the browser refuses playback, still submit the caption so the session moves on.
        player.play().catch(() => { if (audio.current === player) void commit(forKey, clip.text) })
    }

    function stop() {
        audio.current?.pause(); audio.current = null
        if (key) setState({ key, status: 'ready' })
    }

    return { status, caption: clip?.text ?? '', key, playback: status === 'playing' && playback?.key === key ? playback : null, start, stop }
}
