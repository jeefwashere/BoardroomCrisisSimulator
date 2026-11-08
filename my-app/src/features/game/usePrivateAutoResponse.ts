import { useEffect, useRef, useState } from 'react'
import type { PrivateSession } from '../../services/facilitation'
import { facilitationApi } from '../facilitation/facilitationClient'
import { generatedSpeechUrl } from './aiReply'
import { audioDurationMs } from './useAutoResponse'
import type { AutoPlayback, AutoResponseState } from './useAutoResponse'

/**
 * "AI reply" during a private session: Vertex writes a first person answer to the coach's current question, it is
 * spoken in the member's role voice with its caption in the live transcript, then submitted as the answer. Mirrors
 * `useAutoResponse`. The member can always type or speak their own answer instead.
 */
export function usePrivateAutoResponse(roomId: string, session: PrivateSession | null, sending: boolean, answer: (text: string, usedClip: boolean) => Promise<boolean>, onError: (failure: unknown) => void) {
    const [state, setState] = useState<{ key: string | null; status: AutoResponseState }>({ key: null, status: 'ready' })
    const [reply, setReply] = useState<{ key: string; text: string } | null>(null)
    const [playback, setPlayback] = useState<AutoPlayback | null>(null)
    const audio = useRef<HTMLAudioElement | null>(null)
    const objectUrl = useRef<string | null>(null)
    const latestKey = useRef<string | null>(null)
    const expecting = session?.expecting && !session.busy ? session.expecting : null
    const key = expecting ? `${expecting.round}:${expecting.step}` : null

    function release() {
        audio.current?.pause(); audio.current = null
        if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null }
    }

    useEffect(() => {
        latestKey.current = key
        // A new question (or none) stops any reply still playing for the old one.
        return release
    }, [key])

    const status: AutoResponseState = !key ? 'unavailable' : state.key === key ? state.status : 'ready'

    async function commit(forKey: string, caption: string) {
        if (latestKey.current !== forKey) return
        setState({ key: forKey, status: 'saving' })
        const saved = await answer(caption, false)
        setState({ key: forKey, status: saved ? 'done' : 'ready' })
    }

    async function start() {
        if (!expecting || !key || status !== 'ready' || sending) return
        const forKey = key
        setState({ key: forKey, status: 'writing' })
        let drafted
        try { drafted = await facilitationApi.reply(roomId, { mode: 'private', question: expecting.question.slice(0, 1200) }) }
        catch (failure) { onError(failure); if (latestKey.current === forKey) setState({ key: forKey, status: 'ready' }); return }
        if (latestKey.current !== forKey) return
        setReply({ key: forKey, text: drafted.text })
        const url = await generatedSpeechUrl(roomId, drafted.speech_id)
        if (latestKey.current !== forKey) { if (url) URL.revokeObjectURL(url); return }
        if (!url) { await commit(forKey, drafted.text); return }
        release()
        objectUrl.current = url
        const player = new Audio(url)
        audio.current = player
        setState({ key: forKey, status: 'playing' })
        player.addEventListener('playing', () => { if (audio.current === player) setPlayback({ key: forKey, durationMs: audioDurationMs(player) }) }, { once: true })
        player.onended = () => { if (audio.current === player) { release(); void commit(forKey, drafted.text) } }
        player.play().catch(() => { if (audio.current === player) { release(); void commit(forKey, drafted.text) } })
    }

    function stop() {
        release()
        if (key) setState({ key, status: 'ready' })
    }

    return { status, caption: reply && reply.key === key ? reply.text : '', key, playback: status === 'playing' && playback?.key === key ? playback : null, start: () => void start(), stop }
}
