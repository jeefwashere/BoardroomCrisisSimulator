import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { transcriptReducer } from './transcriptModel'
import type { TranscriptEntry, TranscriptInput } from './transcriptModel'

/** Stable write side of the transcript, handed to the stage components. */
export type TranscriptWriter = {
    /** Adds a line with its full text (or updates it in place). */
    upsert: (entry: TranscriptInput) => void
    /** Adds or updates a line that is being spoken now; null `durationMs` shows it in full at once. `elapsedMs` resumes mid line. */
    speak: (entry: TranscriptInput, durationMs: number | null, elapsedMs?: number) => void
    /** The line finished (or was cut off): drop its live dot and show it in full. */
    done: (id: string) => void
}

/** The call's running transcript, owned by the game screen. A new `sessionKey` (new room or game) starts it empty. */
export function useTranscript(sessionKey: string): { entries: TranscriptEntry[]; writer: TranscriptWriter } {
    const [entries, dispatch] = useReducer(transcriptReducer, [])
    const [session, setSession] = useState(sessionKey)
    if (session !== sessionKey) {
        setSession(sessionKey)
        dispatch({ type: 'clear' })
    }
    const upsert = useCallback((entry: TranscriptInput) => dispatch({ type: 'upsert', entry }), [])
    const speak = useCallback((entry: TranscriptInput, durationMs: number | null, elapsedMs = 0) => dispatch({ type: 'speak', entry, at: Date.now() - elapsedMs, durationMs }), [])
    const done = useCallback((id: string) => dispatch({ type: 'done', id }), [])
    const writer = useMemo(() => ({ upsert, speak, done }), [upsert, speak, done])
    return { entries, writer }
}

/**
 * Tracks the one line a stage is speaking so it can be ended from event handlers and is always ended on unmount
 * (a skipped phase never leaves a line stuck as "Speaking").
 */
export function useLiveSpeech(writer: TranscriptWriter) {
    const live = useRef<string | null>(null)
    useEffect(() => () => { if (live.current) writer.done(live.current) }, [writer])
    return useMemo(() => ({
        start(entry: TranscriptInput, durationMs: number | null, elapsedMs = 0) {
            if (live.current && live.current !== entry.id) writer.done(live.current)
            live.current = entry.id
            writer.speak(entry, durationMs, elapsedMs)
        },
        end(id?: string) {
            if (!live.current || (id && id !== live.current)) return
            writer.done(live.current)
            live.current = null
        },
    }), [writer])
}

/**
 * Speaks `line` while it is non null (keyed by its entry ID) and ends it when it goes away or changes.
 * Used for lines whose audio plays elsewhere (Auto response clips, the solo bots' clips on the parent page).
 */
export function useSpokenLine(writer: TranscriptWriter, line: { entry: TranscriptInput; durationMs: number | null } | null) {
    const latest = useRef(line)
    useEffect(() => { latest.current = line })
    const id = line?.entry.id ?? null
    useEffect(() => {
        const current = latest.current
        if (!id || !current) return
        writer.speak(current.entry, current.durationMs)
        return () => writer.done(id)
    }, [id, writer])
}
