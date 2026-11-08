import { useEffect } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import type { RoomSnapshot } from '../../services/rooms'
import { facilitationApi } from '../facilitation/facilitationClient'
import { REPLY_CLIP_PREFIX, streamedSpeech } from './aiReply'
import { sharedClipOffsetSeconds } from './savedClips'

export type SharedClip = { key: string; turn: string; speakerId: string; text: string; remainingMs: number | null }

/**
 * Untimed turns (three window demo): when another player starts their AI reply (or a saved clip), this window plays
 * the same audio from the same moment, so everyone in the room hears the speaker. The speaker's own window plays it itself.
 */
export function useSharedClip(room: RoomSnapshot, catalog: readonly RecordedClip[]): SharedClip | null {
    const game = room.game
    const share = game?.manual_turns && room.phase === 'speaking' ? game.speaker_clip ?? null : null
    const speakerId = game?.active_speaker_id ?? null
    const listening = Boolean(share && speakerId && speakerId !== room.self_member_id)
    const speechId = listening && share?.clip_id.startsWith(REPLY_CLIP_PREFIX) ? share.clip_id.slice(REPLY_CLIP_PREFIX.length) : null
    const saved = listening && share && !speechId ? catalog.find((item) => item.clip_id === share.clip_id) ?? null : null
    const text = speechId ? share?.text ?? '' : saved?.text ?? ''
    const key = listening && share && game && (speechId || saved) ? `${game.phase_id}:${share.clip_id}:${share.started_at}` : null
    // Read once per shared clip: later polls must not restart the audio.
    const offset = share ? sharedClipOffsetSeconds(share.started_at, game?.server_time) : 0
    const duration = saved?.duration_seconds ?? null

    useEffect(() => {
        if (!key) return
        let cancelled = false
        let player: HTMLAudioElement | null = null
        let dispose: (() => void) | null = null
        const begun = performance.now()
        void (async () => {
            // AI replies stream from the same synthesis the speaker hears; saved clips are plain files.
            const speech = speechId ? await streamedSpeech(room.room_id, speechId) : null
            if (cancelled) { speech?.dispose(); return }
            if (speech) { player = speech.player; dispose = speech.dispose }
            else if (saved) player = new Audio(facilitationApi.recordingUrl(saved))
            if (!player) return
            // Start where the speaker is now, including the time spent fetching the audio. A streamed line's length
            // is unknown until it ends; seeking past its end simply ends playback.
            const at = offset + (performance.now() - begun) / 1000
            const audio = player
            audio.addEventListener('loadedmetadata', () => { if (at > 0.3 && !(at >= audio.duration)) audio.currentTime = at }, { once: true })
            audio.play().catch(() => { /* Autoplay refused: the caption still appears in the transcript. */ })
        })()
        return () => {
            cancelled = true
            player?.pause()
            dispose?.()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the shared clip, not on each poll's offset
    }, [key])

    if (!key || !speakerId || !game) return null
    return { key, turn: `${game.phase_id}:${speakerId}`, speakerId, text, remainingMs: duration === null ? null : Math.max(0, Math.round((duration - offset) * 1000)) }
}
