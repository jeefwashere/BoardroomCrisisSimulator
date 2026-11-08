import { useEffect } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import type { RoomSnapshot } from '../../services/rooms'
import { facilitationApi } from '../facilitation/facilitationClient'
import { sharedClipOffsetSeconds } from './savedClips'

export type SharedClip = { key: string; turn: string; speakerId: string; clip: RecordedClip; remainingMs: number | null }

/**
 * Untimed turns (three window demo): when another player starts their saved clip, this window plays the same clip
 * from the same moment, so everyone in the room hears the speaker. The speaker's own window plays it itself.
 */
export function useSharedClip(room: RoomSnapshot, catalog: readonly RecordedClip[]): SharedClip | null {
    const game = room.game
    const share = game?.manual_turns && room.phase === 'speaking' ? game.speaker_clip ?? null : null
    const speakerId = game?.active_speaker_id ?? null
    const clip = share && speakerId && speakerId !== room.self_member_id ? catalog.find((item) => item.clip_id === share.clip_id) ?? null : null
    const key = clip && share && game ? `${game.phase_id}:${share.clip_id}:${share.started_at}` : null
    // Read once per shared clip: later polls must not restart the audio.
    const offset = share ? sharedClipOffsetSeconds(share.started_at, game?.server_time) : 0
    const duration = clip?.duration_seconds ?? null
    const late = duration !== null && offset >= duration

    useEffect(() => {
        if (!key || !clip || late) return
        // A media fragment starts playback at the offset without waiting for metadata.
        const player = new Audio(`${facilitationApi.recordingUrl(clip)}#t=${offset.toFixed(2)}`)
        player.play().catch(() => { /* Autoplay refused: the caption still appears in the transcript. */ })
        return () => { player.pause() }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the shared clip, not on each poll's offset
    }, [key])

    if (!key || !clip || !speakerId || !game) return null
    return { key, turn: `${game.phase_id}:${speakerId}`, speakerId, clip, remainingMs: duration === null ? null : Math.max(0, Math.round((duration - offset) * 1000)) }
}
