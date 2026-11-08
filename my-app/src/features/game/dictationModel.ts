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

type Word = { raw: string; norm: string }

/** Whitespace separated words with a case and punctuation free form for comparison ("restore." matches "restore"). */
function words(text: string): Word[] {
    return text.trim().split(/\s+/).map((raw) => ({ raw, norm: raw.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') })).filter((word) => word.norm)
}

function startsWith(text: readonly Word[], prefix: readonly Word[]): boolean {
    return prefix.length > 0 && prefix.length <= text.length && prefix.every((word, index) => word.norm === text[index].norm)
}

/**
 * The part of a newly final transcript that was not already delivered.
 * Chrome can finalize a phrase and then finalize a revised, longer phrase that repeats it (Android delivers cumulative
 * finals and duplicate finals). A final that repeats an earlier delivered final as its opening words only adds its tail;
 * a final that is fully contained at the start of one already delivered adds nothing.
 */
export function unseenFinal(transcript: string, delivered: readonly string[]): string {
    const next = words(transcript)
    if (!next.length) return ''
    const tail = (count: number) => next.slice(count).map((word) => word.raw).join(' ')
    // Cumulative: the final restates everything delivered so far in this session.
    const session = words(delivered.join(' '))
    if (startsWith(next, session)) return tail(session.length)
    // Revised or duplicate: the final restates (or is a repeat of the start of) the most recent final.
    const last = words(delivered.at(-1) ?? '')
    if (startsWith(next, last)) return tail(last.length)
    if (startsWith(last, next)) return ''
    return tail(0)
}

/**
 * Per recognition session reader. Unlike `readSpeechEvent`, it never hands out the same final words twice:
 * a final result index is delivered once (an event that re-sends it with an older `resultIndex` is ignored) and
 * finals that repeat already delivered words only contribute their new tail.
 */
export function createSpeechReader() {
    const deliveredByIndex = new Map<number, string>()
    const delivered: string[] = []
    return (event: SpeechRecognitionEventLike): { final: string; interim: string } => {
        let final = ''
        let interim = ''
        for (let index = Math.max(0, event.resultIndex); index < event.results.length; index++) {
            const result = event.results[index]
            const transcript = result?.[0]?.transcript ?? ''
            if (!result?.isFinal) { interim = appendTranscript(interim, transcript); continue }
            const clean = transcript.replace(/\s+/g, ' ').trim()
            if (!clean || deliveredByIndex.get(index) === clean) continue
            deliveredByIndex.set(index, clean)
            const fresh = unseenFinal(clean, delivered)
            delivered.push(clean)
            final = appendTranscript(final, fresh)
        }
        return { final, interim }
    }
}

export const DICTATION_UNAVAILABLE = "Voice input isn't available in this browser; type instead."

/** Inline note for a recognition error; null for errors that simply end listening (silence, a manual stop). */
export function dictationErrorNote(error: string): string | null {
    if (error === 'no-speech' || error === 'aborted') return null
    if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture') return DICTATION_UNAVAILABLE
    if (error === 'network') return 'Voice input lost its connection; type instead or try again.'
    return 'Voice input stopped unexpectedly; type instead or try again.'
}
