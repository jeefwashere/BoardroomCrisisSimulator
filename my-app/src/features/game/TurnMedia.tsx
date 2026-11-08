import { useEffect, useState } from 'react'
import type { Extras, Recording, RoomSnapshot } from '../../services/rooms'
import { roomApi, errorMessage } from '../rooms/useRoom'
import type { TurnRecorder } from './useTurnRecorder'
import { recordingsToReview } from './controlBarModel'

const STATUS_TEXT: Record<string, string> = {
    awaiting_audio: 'Waiting for recording upload', validating_audio: 'Checking audio', transcribing: 'Transcribing',
    transcription_disabled: 'Transcription is off. Original audio is saved.', review_required: 'Ready for your review', reviewed: 'Reviewed transcript saved',
    transcription_failed: 'Transcription unavailable', audio_validation_failed: 'Audio validation failed',
}

/**
 * Recording follow ups for the main column. The microphone itself lives in the bottom control bar; this only shows
 * a compact notice when a save failed or one of your transcripts needs review, plus the retained records once the game ends.
 */
const FEEDBACK_WORKING = new Set(['pending', 'waiting_media', 'running'])

export default function TurnMedia({ room, recorder }: { room: RoomSnapshot; recorder: TurnRecorder }) {
    const [notice, setNotice] = useState('')
    const [extras, setExtras] = useState<Extras>({ recordings: [], contributions: [] })
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [audioUrl, setAudioUrl] = useState('')
    const { state, capture } = recorder
    const ended = room.phase === 'ended'
    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout>
        let emptyReads = 0
        async function poll() {
            let incoming: Extras | null = null
            try { incoming = await roomApi.extras(room.room_id, controller.signal); if (!controller.signal.aborted) setExtras(incoming) }
            catch (error) { if (!controller.signal.aborted) setNotice(errorMessage(error)) }
            if (controller.signal.aborted) return
            // After the call: keep asking only while the end of game feedback is still being written.
            if (ended && incoming) {
                const status = incoming.feedback?.status
                if (status ? !FEEDBACK_WORKING.has(status) : ++emptyReads >= 5) return
            }
            timer = setTimeout(() => void poll(), ended ? 3000 : 2000)
        }
        void poll()
        return () => { controller.abort(); clearTimeout(timer) }
    }, [room.room_id, ended])
    useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])
    async function play(recording: Recording) {
        try { const blob = await roomApi.audio(room.room_id, recording.recording_id); setAudioUrl(URL.createObjectURL(blob)) }
        catch (error) { setNotice(errorMessage(error)) }
    }
    async function review(recording: Recording) {
        try { await roomApi.mediaPost(room.room_id, `recordings/${recording.recording_id}/review`, { text: drafts[recording.recording_id] ?? recording.transcript }); setNotice('Reviewed transcript saved.') }
        catch (error) { setNotice(errorMessage(error)) }
    }
    const pending = recordingsToReview(extras.recordings, room.self_member_id)
    const name = (memberId: string) => room.members.find((member) => member.member_id === memberId)?.display_name ?? 'Participant'
    const reviewCard = (recording: Recording) => <article key={recording.recording_id} className="game-review-item">
        <p className="game-review-meta">Round {recording.round_number} · {STATUS_TEXT[recording.status] ?? recording.status}</p>
        <label>Your transcript<textarea value={drafts[recording.recording_id] ?? recording.transcript} onChange={(event) => setDrafts({ ...drafts, [recording.recording_id]: event.target.value })} /></label>
        <div className="game-review-actions">
            {recording.audio_available && <button type="button" className="game-quiet-button" onClick={() => void play(recording)}>Play original</button>}
            <button type="button" onClick={() => void review(recording)}>Save reviewed transcript</button>
        </div>
    </article>
    const failed = state.status === 'error' || state.retryUpload
    if (!ended && !failed && !pending.length && !notice) return null
    return <section className="game-media" aria-label="Recordings">
        {!ended && failed && <div className="game-notice game-notice--warn" role="status">
            <span>{state.message}</span>
            {state.retryUpload && <button type="button" onClick={() => void capture.retryUpload()}>Retry saving</button>}
        </div>}
        {!ended && pending.length > 0 && <details className="game-notice">
            <summary>{pending.length === 1 ? 'Your recording transcript is ready to review' : `${pending.length} recording transcripts are ready to review`}</summary>
            {pending.map(reviewCard)}
        </details>}
        {notice && <p className="game-media-note" role="status">{notice}</p>}
        {audioUrl && <audio controls src={audioUrl} />}
        {ended && extras.feedback?.status !== 'disabled' && <section className="game-feedback-block"><h3>AI feedback</h3><p role="status">{extras.feedback?.status ?? 'Preparing feedback'}</p><p className="game-feedback">{extras.feedback?.text}</p>{extras.feedback?.error && <p>{extras.feedback.error}</p>}{extras.feedback?.evidence_refs?.map((item, index) => <details key={`${item.id}:${index}`}><summary>{item.label}: {item.criterion}</summary><p>AI assessment: {item.assessment === 'supported' ? 'Addresses this criterion' : 'Needs clarification'}</p><blockquote className="game-feedback">{item.quote}</blockquote></details>)}</section>}
        {ended && <details><summary>Recordings and transcripts ({extras.recordings.length})</summary>
            {extras.recordings.map((recording) => recording.member_id === room.self_member_id && !recording.reviewed_text && recording.transcript ? reviewCard(recording) : <article key={recording.recording_id}>
                <h4>{name(recording.member_id)}, round {recording.round_number}</h4>
                <p>{STATUS_TEXT[recording.status] ?? recording.status}{recording.error ? `: ${recording.error}` : ''}</p>
                {recording.audio_available && <button type="button" className="game-quiet-button" onClick={() => void play(recording)}>Play original recording</button>}
                <p>{recording.reviewed_text ?? recording.transcript ?? 'Transcript pending'}</p>
            </article>)}
        </details>}
        {ended && <details><summary>All retained contributions ({extras.contributions.length})</summary>{extras.contributions.map((item, index) => <p key={index}><strong>{name(item.member_id)}:</strong> {item.text}</p>)}</details>}
    </section>
}
