import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ManualTurnRecorder } from './manualRecorder'
import type { Extras, Recording, RoomSnapshot } from '../../services/rooms'
import { roomApi, errorMessage } from '../rooms/useRoom'

function MicrophoneIcon({ stop = false }: { stop?: boolean }) {
    return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{stop ? <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /> : <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>}</svg>
}

function captureTime() { return performance.now() }

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

export default function TurnMedia({ room, portalMode = false, controlsTarget, archiveTarget, feedbackTarget }: { room: RoomSnapshot; portalMode?: boolean; controlsTarget?: HTMLElement | null; archiveTarget?: HTMLElement | null; feedbackTarget?: HTMLElement | null }) {
    const [notice, setNotice] = useState('')
    const [extras, setExtras] = useState<Extras>({ recordings: [], contributions: [] })
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [audioUrl, setAudioUrl] = useState('')
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
    const recordingState = useSyncExternalStore(capture.subscribe, capture.getSnapshot, capture.getSnapshot)
    useEffect(() => {
        capture.setTurn(ownTurn && game ? {
            phaseId: game.phase_id,
            roundId: game.round_id,
            remainingMs: game.phase_deadline && game.server_time ? Math.max(0, Date.parse(game.phase_deadline) - Date.parse(game.server_time)) : 30000,
            observedAt: performance.now(),
        } : null)
    }, [capture, ownTurn, game])
    useEffect(() => () => capture.dispose(), [capture])
    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout>
        async function poll() {
            try { const incoming = await roomApi.extras(room.room_id, controller.signal); if (!controller.signal.aborted) setExtras(incoming) }
            catch (error) { if (!controller.signal.aborted) setNotice(errorMessage(error)) }
            if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000)
        }
        void poll()
        return () => { controller.abort(); clearTimeout(timer) }
    }, [room.room_id])
    useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])
    async function play(recording: Recording) {
        try { const blob = await roomApi.audio(room.room_id, recording.recording_id); setAudioUrl(URL.createObjectURL(blob)) }
        catch (error) { setNotice(errorMessage(error)) }
    }
    async function review(recording: Recording) {
        try { await roomApi.mediaPost(room.room_id, `recordings/${recording.recording_id}/review`, { text: drafts[recording.recording_id] ?? recording.transcript }); setNotice('Reviewed transcript saved with your recording.') }
        catch (error) { setNotice(errorMessage(error)) }
    }
    const feedback = room.phase === 'ended' && <section className="game-feedback-card"><h3>Session evaluation</h3><p role="status">{extras.feedback?.status ?? 'Preparing feedback'}</p><p className="game-feedback">{extras.feedback?.text}</p>{extras.feedback?.error && <p>{extras.feedback.error}</p>}{extras.feedback?.evidence_refs?.map((item, index) => <details key={`${item.id}:${index}`}><summary>{item.label}: {item.criterion}</summary><p>AI assessment: {item.assessment === 'supported' ? 'Addresses this criterion' : 'Needs clarification'}</p><blockquote className="game-feedback">{item.quote}</blockquote></details>)}</section>
    const archive = <section className="game-media" aria-label="Speaking recordings">
        {!portalMode && room.phase !== 'ended' && <div className={`microphone-control microphone-${recordingState.status}`}>
            <p className="microphone-status" role="status"><span aria-hidden="true">{recordingState.status === 'recording' ? '●' : '◉'}</span> {recordingState.message}</p>
            {recordingState.status === 'requesting' ? <button type="button" onClick={capture.stop}>Cancel microphone request</button>
                : recordingState.status === 'recording' ? <button type="button" className="microphone-stop" onClick={capture.stop}><MicrophoneIcon stop /> Stop and save recording</button>
                    : <button type="button" disabled={!ownTurn || ['stopping', 'saving'].includes(recordingState.status) || recordingState.retryUpload || (recordingState.status === 'saved' && recordingState.phaseId === game?.phase_id)} onClick={() => void capture.start()}><MicrophoneIcon /> {recordingState.status === 'saving' ? 'Saving original…' : recordingState.status === 'stopping' ? 'Finishing recording…' : recordingState.status === 'saved' && recordingState.phaseId === game?.phase_id ? 'Saved for this turn' : 'Start recording'}</button>}
            <p className="microphone-help">Each turn needs a new Start. One original per turn. Audio is shared with room participants and sent for transcription when enabled.</p>
        </div>}
        {recordingState.retryUpload && <button type="button" onClick={() => void capture.retryUpload()}>Retry saving original audio</button>}
        {room.phase === 'ended' && <p role="status">{recordingState.message}</p>}
        {notice && <p role="status">{notice}</p>}
        {audioUrl && <audio controls src={audioUrl} />}
        {!portalMode && feedback}
        <details><summary>Recordings and transcripts ({extras.recordings.length})</summary>
            {extras.recordings.map((recording) => <article key={recording.recording_id}>
                <h4>{room.members.find((member) => member.member_id === recording.member_id)?.display_name ?? 'Participant'}, round {recording.round_number}</h4>
                <p>{{ awaiting_audio: 'Waiting for recording upload', validating_audio: 'Checking audio', transcribing: 'Transcribing', transcription_disabled: 'Transcription is off. Original audio is saved.', review_required: 'Ready for your review', reviewed: 'Reviewed transcript saved', transcription_failed: 'Transcription unavailable', audio_validation_failed: 'Audio validation failed' }[recording.status] ?? recording.status}{recording.error ? `: ${recording.error}` : ''}</p>
                {recording.audio_available && <button type="button" onClick={() => void play(recording)}>Play original recording</button>}
                <p>{recording.reviewed_text ?? recording.transcript ?? 'Transcript pending'}</p>
                {recording.member_id === room.self_member_id && !recording.reviewed_text && recording.transcript && <><label>Review your transcript<textarea value={drafts[recording.recording_id] ?? recording.transcript} onChange={(event) => setDrafts({ ...drafts, [recording.recording_id]: event.target.value })} /></label><button type="button" onClick={() => void review(recording)}>Save reviewed transcript</button></>}
            </article>)}
        </details>
        <details><summary>All retained contributions ({extras.contributions.length})</summary>{extras.contributions.map((item, index) => <p key={index}><strong>{room.members.find((member) => member.member_id === item.member_id)?.display_name}:</strong> {item.text}</p>)}</details>
    </section>
    if (!portalMode) return archive
    const active = ['recording', 'requesting'].includes(recordingState.status)
    const locked = !active && (!ownTurn || ['stopping', 'saving'].includes(recordingState.status) || recordingState.retryUpload || (recordingState.status === 'saved' && recordingState.phaseId === game?.phase_id))
    return <>
        {controlsTarget && createPortal(<div className="game-microphone-dock">
            <button type="button" className={active ? 'is-recording' : ''} aria-label={active ? 'Mute microphone and save recording' : 'Unmute microphone and record your turn'} aria-pressed={active} disabled={locked} title={recordingState.message} onClick={() => { if (active) capture.stop(); else void capture.start() }}><MicrophoneIcon /> <span>{active ? 'Mute' : 'Unmute'}</span>{!active && <span className="game-mic-slash" aria-hidden="true" />}</button>
            <span className="game-visually-hidden" role="status">{recordingState.message}</span>
            {recordingState.retryUpload && <button type="button" onClick={() => void capture.retryUpload()}>Retry audio</button>}
            {recordingState.status === 'error' && <span className="game-microphone-error" role="alert">{recordingState.message}</span>}
        </div>, controlsTarget)}
        {archiveTarget && createPortal(archive, archiveTarget)}
        {feedbackTarget && createPortal(feedback, feedbackTarget)}
    </>
}
