import { facilitationApi } from '../facilitation/facilitationClient'

/** Prefix for an AI reply shared as the speaker's clip (`speaker_clip.clip_id`), followed by its speech ID. */
export const REPLY_CLIP_PREFIX = 'reply:'

/**
 * ElevenLabs audio for a generated line, as an object URL (revoke it when done), or null when speech is off or failed.
 * The backend picks the voice of whoever speaks the line.
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
