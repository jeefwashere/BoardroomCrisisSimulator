import { facilitationApi } from '../facilitation/facilitationClient'

/** Prefix for an AI reply shared as the speaker's clip (`speaker_clip.clip_id`), followed by its speech ID. */
export const REPLY_CLIP_PREFIX = 'reply:'

/**
 * ElevenLabs audio for a generated line, as an object URL (revoke it when done), or null when speech is off or failed.
 * The backend picks the voice of whoever speaks the line. Waits for the whole file; prefer `streamedSpeech`.
 */
export async function generatedSpeechUrl(roomId: string, speechId: string): Promise<string | null> {
    try {
        const status = await facilitationApi.prepareSpeech(roomId, speechId)
        if (status.status !== 'ready') return null
        return URL.createObjectURL(await facilitationApi.speechAudio(roomId, speechId))
    } catch {
        return null
    }
}

export type SpeechPlayer = { player: HTMLAudioElement; dispose: () => void }

/** True when this browser can play MP3 while it downloads (Media Source Extensions). */
export function canStreamSpeech(): boolean {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg')
}

/**
 * A player for a generated line that starts as soon as the first audio arrives (about a quarter second after
 * ElevenLabs starts), instead of waiting for the whole file. Every window streams from the same synthesis on the
 * server. Falls back to the whole file where streaming is unsupported; null when speech is off or failed.
 * Call `dispose` when done; a stream that breaks ends the player early (its `error` or `ended` event fires).
 */
export async function streamedSpeech(roomId: string, speechId: string): Promise<SpeechPlayer | null> {
    if (!canStreamSpeech()) {
        const url = await generatedSpeechUrl(roomId, speechId)
        return url ? { player: new Audio(url), dispose: () => URL.revokeObjectURL(url) } : null
    }
    const controller = new AbortController()
    let response: Response
    try { response = await facilitationApi.speechStream(roomId, speechId, controller.signal) } catch { return null }
    const reader = response.body!.getReader()
    const source = new MediaSource()
    const url = URL.createObjectURL(source)
    const player = new Audio(url)
    let disposed = false
    source.addEventListener('sourceopen', () => {
        const buffer = source.addSourceBuffer('audio/mpeg')
        const appended = () => new Promise<void>((resolve) => buffer.addEventListener('updateend', () => resolve(), { once: true }))
        void (async () => {
            try {
                for (;;) {
                    const { done, value } = await reader.read()
                    if (done || disposed) break
                    buffer.appendBuffer(value)
                    await appended()
                }
                if (!disposed && source.readyState === 'open') source.endOfStream()
            } catch {
                if (!disposed && source.readyState === 'open') source.endOfStream('network')
            }
        })()
    }, { once: true })
    return {
        player,
        dispose: () => {
            disposed = true
            controller.abort()
            player.pause()
            URL.revokeObjectURL(url)
        },
    }
}
