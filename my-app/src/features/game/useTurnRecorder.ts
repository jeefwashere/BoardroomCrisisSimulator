import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { ManualTurnRecorder } from './manualRecorder'
import type { RoomSnapshot } from '../../services/rooms'
import { roomApi } from '../rooms/useRoom'

function captureTime() { return performance.now() }

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

/**
 * The caller's own speaking turn recorder (browser MediaRecorder, authenticated grant and upload).
 * Recording only starts from an explicit `start()` during the caller's own speaking turn and stops when the turn moves on.
 */
export function useTurnRecorder(room: RoomSnapshot) {
    const game = room.game
    const ownTurn = room.phase === 'speaking' && game?.active_speaker_id === room.self_member_id
    const capture = useMemo(() => new ManualTurnRecorder({
        microphone: async () => {
            if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording requires a supported browser and permission.')
            return navigator.mediaDevices.getUserMedia({ audio: true })
        },
        recorder: (stream) => {
            const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((value) => MediaRecorder.isTypeSupported(value))
            return new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
        },
        authorize: async (turn) => {
            const current = await roomApi.snapshot(room.room_id)
            return current.phase === 'speaking' && current.game?.phase_id === turn.phaseId && current.game.active_speaker_id === room.self_member_id
        },
        grant: (turn) => roomApi.mediaPost(room.room_id, 'recordings/begin', { command_id: crypto.randomUUID(), phase_id: turn.phaseId, round_id: turn.roundId }),
        upload: (id, body) => roomApi.mediaPost(room.room_id, `recordings/${id}`, body),
        encode: toBase64,
        now: captureTime,
    }), [room.room_id, room.self_member_id])
    const state = useSyncExternalStore(capture.subscribe, capture.getSnapshot)
    useEffect(() => {
        capture.setTurn(ownTurn && game ? {
            phaseId: game.phase_id,
            roundId: game.round_id,
            remainingMs: game.phase_deadline && game.server_time ? Math.max(0, Date.parse(game.phase_deadline) - Date.parse(game.server_time)) : 30000,
            observedAt: performance.now(),
        } : null)
    }, [capture, ownTurn, game])
    useEffect(() => () => capture.dispose(), [capture])
    return { capture, state, ownTurn }
}

export type TurnRecorder = ReturnType<typeof useTurnRecorder>
