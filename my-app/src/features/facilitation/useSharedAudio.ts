import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'

export type SharedAudioState = { key: string | null; playing: boolean; loading: boolean; current: number; duration: number; error: string }

const idle: SharedAudioState = { key: null, playing: false, loading: false, current: 0, duration: 0, error: '' }

/**
 * One shared <audio> element for the whole panel: starting any clip or reply stops the previous one.
 * Playback is local only; nothing here posts to the server.
 */
export function useSharedAudio() {
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [state, setState] = useState<SharedAudioState>(idle)

    useEffect(() => () => { audioRef.current?.pause() }, [])

    const toggle = useCallback((key: string, src: string) => {
        const audio = audioRef.current
        if (!audio) return
        if (state.key === key && audio.src) {
            if (audio.paused) void audio.play().catch(() => setState((current) => ({ ...current, playing: false, loading: false, error: 'Playback was blocked by the browser. Press play again.' })))
            else audio.pause()
            return
        }
        audio.pause()
        audio.src = src
        setState({ ...idle, key, loading: true })
        void audio.play().catch((failure: unknown) => {
            if (failure instanceof Error && failure.name === 'AbortError') return
            setState((current) => current.key === key ? { ...current, playing: false, loading: false, error: 'This audio could not be played.' } : current)
        })
    }, [state.key])

    const stop = useCallback(() => {
        const audio = audioRef.current
        if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
        setState(idle)
    }, [])

    const sync = (event: SyntheticEvent<HTMLAudioElement>) => {
        const audio = event.currentTarget
        setState((current) => ({ ...current, current: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : current.duration }))
    }

    const audioProps = {
        ref: audioRef,
        preload: 'none' as const,
        hidden: true,
        onPlaying: () => setState((current) => ({ ...current, playing: true, loading: false, error: '' })),
        onPause: () => setState((current) => ({ ...current, playing: false, loading: false })),
        onWaiting: () => setState((current) => ({ ...current, loading: true })),
        onTimeUpdate: sync,
        onLoadedMetadata: sync,
        onEnded: (event: SyntheticEvent<HTMLAudioElement>) => { sync(event); setState((current) => ({ ...current, playing: false, current: 0 })) },
        onError: (event: SyntheticEvent<HTMLAudioElement>) => {
            if (!event.currentTarget.getAttribute('src')) return
            setState((current) => ({ ...current, playing: false, loading: false, error: 'This audio is unavailable right now.' }))
        },
    }

    return { state, toggle, stop, audioProps }
}
