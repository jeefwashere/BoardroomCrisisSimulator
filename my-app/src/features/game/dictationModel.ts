// Pure helpers for browser dictation (Web Speech API) so the transcript merge can be unit tested.

/** Minimal typing of the parts of the Web Speech API this app uses (no extra dependency). */
export type SpeechAlternativeLike = { transcript: string }
export type SpeechResultLike = { readonly isFinal: boolean; readonly length: number; readonly [index: number]: SpeechAlternativeLike }
export type SpeechResultListLike = { readonly length: number; readonly [index: number]: SpeechResultLike }
export type SpeechRecognitionEventLike = { resultIndex: number; results: SpeechResultListLike }
export type SpeechRecognitionErrorEventLike = { error: string }
export type SpeechRecognitionLike = {
    lang: string
    continuous: boolean
    interimResults: boolean
    onresult: ((event: SpeechRecognitionEventLike) => void) | null
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
    onend: (() => void) | null
    start(): void
    stop(): void
    abort(): void
}
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

/** The browser's recognizer constructor, or null when dictation is unsupported. */
export function speechRecognitionConstructor(scope: unknown): SpeechRecognitionConstructor | null {
    if (typeof scope !== 'object' || scope === null) return null
    const candidate = (scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
    const ctor = candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition
    return typeof ctor === 'function' ? ctor as SpeechRecognitionConstructor : null
}

/** Appends dictated words to what is already typed, with exactly one space between them. */
export function appendTranscript(text: string, addition: string): string {
    const words = addition.replace(/\s+/g, ' ').trim()
    if (!words) return text
    if (!text) return words
    return /\s$/.test(text) ? text + words : `${text} ${words}`
}

/**
 * Splits one recognition event into newly finalized words and the current interim words.
 * Only results from `resultIndex` on are new; earlier final results were already delivered.
 */
export function readSpeechEvent(event: SpeechRecognitionEventLike): { final: string; interim: string } {
    let final = ''
    let interim = ''
    for (let index = Math.max(0, event.resultIndex); index < event.results.length; index++) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript ?? ''
        if (result?.isFinal) final = appendTranscript(final, transcript)
        else interim = appendTranscript(interim, transcript)
    }
    return { final, interim }
}

export const DICTATION_UNAVAILABLE = "Voice input isn't available in this browser; type instead."

/** Inline note for a recognition error; null for errors that simply end listening (silence, a manual stop). */
export function dictationErrorNote(error: string): string | null {
    if (error === 'no-speech' || error === 'aborted') return null
    if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture') return DICTATION_UNAVAILABLE
    if (error === 'network') return 'Voice input lost its connection; type instead or try again.'
    return 'Voice input stopped unexpectedly; type instead or try again.'
}
