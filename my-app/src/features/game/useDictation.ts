import { useCallback, useEffect, useRef, useState } from 'react'
import { DICTATION_UNAVAILABLE, createSpeechReader, speechRecognitionConstructor } from './dictationModel'
import type { SpeechRecognitionLike } from './dictationModel'

/** Sends one recorded clip to the server's speech to text and resolves with its words. */
export type Transcribe = (clip: { audio_base64: string; mime_type: string }) => Promise<string>

const MAX_MS = 120_000
const MIN_BYTES = 1500

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

function failureText(error: unknown): string {
    const message = error instanceof Error ? error.message : ''
    return message && message.length < 160 ? message : 'Transcription is unavailable right now; type instead or try again.'
}

type Capture = {
    stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; audio?: AudioContext; meter?: ReturnType<typeof setInterval>
    limit: ReturnType<typeof setTimeout>; clock: ReturnType<typeof setInterval>; recognition: SpeechRecognitionLike | null; heard: string
}

/**
 * Dictation that works in every browser with a microphone: Dictate records the member's voice and Stop sends the clip
 * to the server (ElevenLabs Scribe), whose words go to `onFinal` (appended to the draft). While recording, `level`
 * shows the microphone is hearing them, and where the browser's own speech recognition works its words appear live in
 * `interim` as a preview (Chrome); it is never required. Without a server, the browser's words are used instead.
 */
export function useDictation(onFinal: (words: string) => void, transcribe?: Transcribe) {
    const [supported] = useState(() => typeof window !== 'undefined' && (
        (Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined') || speechRecognitionConstructor(window) !== null))
    const [listening, setListening] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [interim, setInterim] = useState('')
    const [level, setLevel] = useState(0)
    const [seconds, setSeconds] = useState(0)
    const [note, setNote] = useState('')
    const capture = useRef<Capture | null>(null)
    const starting = useRef(false)
    const browserOnly = useRef<SpeechRecognitionLike | null>(null)
    const onFinalRef = useRef(onFinal)
    const transcribeRef = useRef(transcribe)
    useEffect(() => { onFinalRef.current = onFinal; transcribeRef.current = transcribe })

    /** Browser speech recognition: a live preview while recording, or the whole dictation when recording is impossible. */
    const recognize = useCallback((onWords: (final: string, interim: string) => void, onEnd: () => void) => {
        const Recognition = speechRecognitionConstructor(window)
        if (!Recognition) return null
        try {
            const instance = new Recognition()
            instance.lang = 'en-US'
            instance.continuous = true
            instance.interimResults = true
            const read = createSpeechReader()
            instance.onresult = (event) => { const { final, interim: words } = read(event); onWords(final, words) }
            instance.onerror = () => undefined // Preview only: many browsers fail here silently; the recording still works.
            instance.onend = onEnd
            instance.start()
            return instance
        } catch {
            return null
        }
    }, [])

    const finish = useCallback(async (current: Capture) => {
        clearTimeout(current.limit)
        clearInterval(current.clock)
        if (current.meter) clearInterval(current.meter)
        void current.audio?.close().catch(() => undefined)
        current.stream.getTracks().forEach((track) => track.stop())
        if (current.recognition) { current.recognition.onend = null; current.recognition.abort() }
        setListening(false)
        setLevel(0)
        const blob = new Blob(current.chunks, { type: current.recorder.mimeType || 'audio/webm' })
        const heard = current.heard.trim()
        if (blob.size < MIN_BYTES || !transcribeRef.current) {
            setInterim('')
            if (heard) onFinalRef.current(heard)
            else if (blob.size < MIN_BYTES) setNote('No speech was recorded. Press Dictate and speak, then press Stop.')
            return
        }
        setTranscribing(true)
        try {
            const words = await transcribeRef.current({ audio_base64: await toBase64(blob), mime_type: blob.type })
            if (words.trim()) onFinalRef.current(words.trim())
            else setNote('No words were recognised. Try again a little closer to the microphone.')
        } catch (error) {
            if (heard) onFinalRef.current(heard)
            else setNote(failureText(error))
        } finally {
            setTranscribing(false)
            setInterim('')
        }
    }, [])

    const stop = useCallback(() => {
        const current = capture.current
        if (current) {
            capture.current = null
            if (current.recorder.state !== 'inactive') current.recorder.stop() // onstop calls finish
            else void finish(current)
            return
        }
        browserOnly.current?.stop()
    }, [finish])

    const start = useCallback(async () => {
        if (capture.current || starting.current || browserOnly.current) return
        setNote('')
        setInterim('')
        const canRecord = Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
        if (!canRecord) {
            // No recording in this browser: dictate with its own speech recognition only.
            let finals = ''
            const instance = recognize((final, words) => {
                if (final) { finals += final; onFinalRef.current(final) }
                setInterim(words)
            }, () => { browserOnly.current = null; setListening(false); setInterim(''); if (!finals) setNote('No words were recognised.') })
            if (!instance) { setNote(DICTATION_UNAVAILABLE); return }
            browserOnly.current = instance
            setListening(true)
            return
        }
        starting.current = true
        setListening(true)
        setSeconds(0)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((value) => MediaRecorder.isTypeSupported(value))
            const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
            const began = Date.now()
            const current: Capture = { stream, recorder, chunks: [], recognition: null, heard: '', limit: setTimeout(() => stop(), MAX_MS),
                clock: setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 250) }
            recorder.ondataavailable = (event) => { if (event.data.size) current.chunks.push(event.data) }
            recorder.onstop = () => void finish(current)
            // Microphone level, so the member can see they are being heard even without live words.
            try {
                const audio = new AudioContext()
                const analyser = audio.createAnalyser()
                analyser.fftSize = 512
                audio.createMediaStreamSource(stream).connect(analyser)
                const samples = new Uint8Array(analyser.fftSize)
                current.audio = audio
                current.meter = setInterval(() => {
                    analyser.getByteTimeDomainData(samples)
                    let peak = 0
                    for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128))
                    setLevel(Math.min(1, peak / 64))
                }, 90)
            } catch { /* The level meter is optional. */ }
            current.recognition = recognize((final, words) => {
                if (final) current.heard += final
                setInterim(`${current.heard}${words ? ` ${words}` : ''}`.trim())
            }, () => { current.recognition = null })
            capture.current = current
            recorder.start(250)
        } catch {
            setListening(false)
            setNote("The microphone is blocked or unavailable. Allow microphone access for this site, or type in Chat instead.")
        } finally {
            starting.current = false
        }
    }, [finish, recognize, stop])

    useEffect(() => () => {
        const current = capture.current
        capture.current = null
        if (current) {
            clearTimeout(current.limit)
            clearInterval(current.clock)
            if (current.meter) clearInterval(current.meter)
            void current.audio?.close().catch(() => undefined)
            current.recorder.onstop = null
            if (current.recorder.state !== 'inactive') current.recorder.stop()
            current.stream.getTracks().forEach((track) => track.stop())
            current.recognition?.abort()
        }
        browserOnly.current?.abort()
    }, [])

    return { supported, listening, transcribing, interim, level, seconds, note, start: () => void start(), stop }
}
