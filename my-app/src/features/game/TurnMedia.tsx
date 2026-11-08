import { useEffect, useRef, useState } from 'react'
import type { Extras, Recording, RoomSnapshot } from '../../services/rooms'
import { roomApi, errorMessage } from '../rooms/useRoom'

function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}

export default function TurnMedia({ room }: { room: RoomSnapshot }) {
    const [consent, setConsent] = useState(false)
    const [notice, setNotice] = useState('')
    const [canRetry, setCanRetry] = useState(false)
    const [captureAttempt, setCaptureAttempt] = useState(0)
    const [extras, setExtras] = useState<Extras>({ recordings: [], contributions: [] })
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [audioUrl, setAudioUrl] = useState('')
    const [uploadFailed, setUploadFailed] = useState(false)
    const uploadRef = useRef<{ id: string; blob: Blob } | null>(null)
    const latestGame = useRef(room.game)
    const game = room.game
    const saveOriginalRef = useRef(saveOriginal)
    useEffect(() => { saveOriginalRef.current = saveOriginal })
    const phaseId = game?.phase_id
    useEffect(() => { latestGame.current = game }, [game])
    const ownTurn = room.phase === 'speaking' && game?.active_speaker_id === room.self_member_id
    async function saveOriginal(id: string, blob: Blob) {
        uploadRef.current = { id, blob }
        try {
            await roomApi.mediaPost(room.room_id, `recordings/${id}`, { audio_base64: await toBase64(blob), mime_type: blob.type })
            uploadRef.current = null
            setUploadFailed(false)
            setCanRetry(false)
            setNotice('Original recording saved. Review the transcript when ready.')
        } catch (error) { setUploadFailed(true); setNotice(errorMessage(error)) }
    }
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
    useEffect(() => {
        if (!consent || !ownTurn || !latestGame.current) return
        const turnGame = latestGame.current
        const observedAt = performance.now()
        let stopped = false
        let recorder: MediaRecorder | undefined
        let stream: MediaStream | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let guard: ReturnType<typeof setInterval> | undefined
        let checking = false
        const currentPhaseId = turnGame.phase_id
        const roundId = turnGame.round_id
        const stop = () => { stopped = true; clearTimeout(timer); clearInterval(guard); if (recorder?.state === 'recording') recorder.stop(); stream?.getTracks().forEach((track) => track.stop()) }
        async function begin() {
            try {
                if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording requires a supported browser and permission.')
                stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                if (stopped) { stream.getTracks().forEach((track) => track.stop()); return }
                const grant = await roomApi.mediaPost(room.room_id, 'recordings/begin', { command_id: crypto.randomUUID(), phase_id: currentPhaseId, round_id: roundId })
                if (stopped || grant.audio_available) { stream.getTracks().forEach((track) => track.stop()); if (grant.audio_available) setNotice('Your original recording is already saved.'); return }
                const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((value) => MediaRecorder.isTypeSupported(value))
                recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
                const chunks: Blob[] = []
                let size = 0
                recorder.onerror = () => { setNotice('Recording failed. Retry while your turn is active, or keep a typed answer.'); setCanRetry(true); stop() }
                recorder.ondataavailable = (event) => { if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size > 10000000) stop() } }
                recorder.onstop = () => {
                    stream?.getTracks().forEach((track) => track.stop())
                    const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
                    if (!blob.size || blob.size > 10000000) { setNotice('Recording could not be saved. Keep your typed answer.'); setCanRetry(true); return }
                    void saveOriginalRef.current(grant.recording_id, blob)
                }
                recorder.start(100)
                guard = setInterval(() => {
                    if (checking || stopped) return
                    checking = true
                    void roomApi.snapshot(room.room_id).then((current) => { if (current.phase !== 'speaking' || current.game?.phase_id !== currentPhaseId || current.game.active_speaker_id !== room.self_member_id) stop() }).catch(() => { setNotice('Connection lost. Recording stopped; retry saving the original audio when connected.'); stop() }).finally(() => { checking = false })
                }, 100)
                setNotice('Recording your speaking turn. Audio stays linked to your seat.')
                const remaining = turnGame.phase_deadline && turnGame.server_time ? Date.parse(turnGame.phase_deadline) - Date.parse(turnGame.server_time) - (performance.now() - observedAt) : 30000
                timer = setTimeout(stop, Math.max(0, Math.min(30000, remaining)))
            } catch (error) { stream?.getTracks().forEach((track) => track.stop()); setNotice(errorMessage(error)); setCanRetry(true) }

        }
        void begin()
        return stop
    }, [consent, ownTurn, phaseId, captureAttempt, room.room_id, room.self_member_id])
    useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }, [audioUrl])
    async function play(recording: Recording) {
        try { const blob = await roomApi.audio(room.room_id, recording.recording_id); setAudioUrl(URL.createObjectURL(blob)) }
        catch (error) { setNotice(errorMessage(error)) }
    }
    async function review(recording: Recording) {
        try { await roomApi.mediaPost(room.room_id, `recordings/${recording.recording_id}/review`, { text: drafts[recording.recording_id] ?? recording.transcript }); setNotice('Reviewed transcript saved with your recording.') }
        catch (error) { setNotice(errorMessage(error)) }
    }
    return <section className="game-media" aria-label="Speaking recordings">
        {room.phase !== 'ended' && <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Record my speaking turns and send audio for transcription. Room participants can review these recordings.</label>}
        {uploadFailed && <button type="button" onClick={() => { const pending = uploadRef.current; if (pending) void saveOriginal(pending.id, pending.blob) }}>Retry saving original audio</button>}
        {ownTurn && consent && canRetry && <button type="button" onClick={() => { setCanRetry(false); setCaptureAttempt((value) => value + 1) }}>Retry recording</button>}
        {notice && <p role="status">{notice}</p>}
        {audioUrl && <audio controls src={audioUrl} />}
        {room.phase === 'ended' && <section><h3>AI feedback</h3><p role="status">{extras.feedback?.status ?? 'Preparing feedback'}</p><p className="game-feedback">{extras.feedback?.text}</p>{extras.feedback?.error && <p>{extras.feedback.error}</p>}</section>}
        <details open={room.phase === 'ended'}><summary>Recordings and transcripts ({extras.recordings.length})</summary>
            {extras.recordings.map((recording) => <article key={recording.recording_id}>
                <h4>{room.members.find((member) => member.member_id === recording.member_id)?.display_name ?? 'Participant'}, round {recording.round_number}</h4>
                <p>{{ awaiting_audio: 'Waiting for recording upload', validating_audio: 'Checking audio', transcribing: 'Transcribing', transcription_disabled: 'Transcription is off. Original audio is saved.', review_required: 'Ready for your review', reviewed: 'Reviewed transcript saved', transcription_failed: 'Transcription unavailable', audio_validation_failed: 'Audio validation failed' }[recording.status] ?? recording.status}{recording.error ? `: ${recording.error}` : ''}</p>
                {recording.audio_available && <button type="button" onClick={() => void play(recording)}>Play original recording</button>}
                <p>{recording.reviewed_text ?? recording.transcript ?? 'Transcript pending'}</p>
                {recording.member_id === room.self_member_id && !recording.reviewed_text && recording.transcript && <><label>Review your transcript<textarea value={drafts[recording.recording_id] ?? recording.transcript} onChange={(event) => setDrafts({ ...drafts, [recording.recording_id]: event.target.value })} /></label><button type="button" onClick={() => void review(recording)}>Save reviewed transcript</button></>}
            </article>)}
        </details>
        <details open={room.phase === 'ended'}><summary>All retained contributions ({extras.contributions.length})</summary>{extras.contributions.map((item, index) => <p key={index}><strong>{room.members.find((member) => member.member_id === item.member_id)?.display_name}:</strong> {item.text}</p>)}</details>
    </section>
}
