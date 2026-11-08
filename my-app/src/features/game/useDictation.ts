import { useCallback, useEffect, useRef, useState } from 'react'
import { DICTATION_UNAVAILABLE, dictationErrorNote, readSpeechEvent, speechRecognitionConstructor } from './dictationModel'
import type { SpeechRecognitionLike } from './dictationModel'

/**
 * Browser dictation through the Web Speech API. Final words are handed to `onFinal` (append them to the draft);
 * interim words are exposed for live display. Listening stops on `stop()` and on unmount.
 */
export function useDictation(onFinal: (words: string) => void) {
    const [supported] = useState(() => typeof window !== 'undefined' && speechRecognitionConstructor(window) !== null)
    const [listening, setListening] = useState(false)
    const [interim, setInterim] = useState('')
    const [note, setNote] = useState('')
    const recognition = useRef<SpeechRecognitionLike | null>(null)
    const onFinalRef = useRef(onFinal)
    useEffect(() => { onFinalRef.current = onFinal })

    const stop = useCallback(() => {
        recognition.current?.stop()
    }, [])

    const start = useCallback(() => {
        const Recognition = speechRecognitionConstructor(window)
        if (!Recognition) { setNote(DICTATION_UNAVAILABLE); return }
        if (recognition.current) return
        let instance: SpeechRecognitionLike
        try { instance = new Recognition() } catch { setNote(DICTATION_UNAVAILABLE); return }
        instance.lang = 'en-US'
        instance.continuous = true
        instance.interimResults = true
        instance.onresult = (event) => {
            const { final, interim: words } = readSpeechEvent(event)
            if (final) onFinalRef.current(final)
            setInterim(words)
        }
        instance.onerror = (event) => {
            const message = dictationErrorNote(event.error)
            if (message) setNote(message)
        }
        instance.onend = () => {
            if (recognition.current === instance) recognition.current = null
            setListening(false)
            setInterim('')
        }
        recognition.current = instance
        setNote('')
        try {
            instance.start()
            setListening(true)
        } catch {
            recognition.current = null
            setNote(DICTATION_UNAVAILABLE)
        }
    }, [])

    useEffect(() => () => {
        const instance = recognition.current
        recognition.current = null
        if (instance) { instance.onresult = null; instance.onend = null; instance.onerror = null; instance.abort() }
    }, [])

    return { supported, listening, interim, note, start, stop }
}
