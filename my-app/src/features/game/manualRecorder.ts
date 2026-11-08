export type CaptureStatus = 'idle' | 'requesting' | 'recording' | 'stopping' | 'saving' | 'saved' | 'error'
export type CaptureState = { status: CaptureStatus; phaseId?: string; message: string; retryUpload: boolean }
export type CaptureTurn = { phaseId: string; roundId: string; remainingMs: number; observedAt: number }
type Grant = { recording_id: string; audio_available: boolean }
type RecorderDependencies = {
    microphone: () => Promise<MediaStream>
    recorder: (stream: MediaStream) => MediaRecorder
    authorize: (turn: CaptureTurn) => Promise<boolean>
    grant: (turn: CaptureTurn) => Promise<Grant>
    upload: (id: string, body: { audio_base64: string; mime_type: string }) => Promise<unknown>
    encode: (blob: Blob) => Promise<string>
    now: () => number
}
type Attempt = { turn: CaptureTurn; cancelled: boolean; stream?: MediaStream; recorder?: MediaRecorder; timer?: ReturnType<typeof setTimeout>; guard?: ReturnType<typeof setInterval> }
type Pending = { id: string; blob: Blob; phaseId: string; body?: { audio_base64: string; mime_type: string } }
const MAX_BYTES = 10000000

// Owns one capture and its original until the server acknowledges those exact bytes.
export class ManualTurnRecorder {
    private state: CaptureState = { status: 'idle', message: 'Microphone off. Start recording during your own speaking turn.', retryUpload: false }
    private listeners = new Set<() => void>()
    private turn: CaptureTurn | null = null
    private attempt?: Attempt
    private pending?: Pending
    private uploading = false
    private saved = new Set<string>()
    private deps: RecorderDependencies

    constructor(deps: RecorderDependencies) { this.deps = deps }
    getSnapshot = () => this.state
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
    private publish(status: CaptureStatus, message: string, phaseId = this.attempt?.turn.phaseId ?? this.state.phaseId) {
        this.state = { status, message, phaseId, retryUpload: !!this.pending && !this.uploading }
        this.listeners.forEach((listener) => listener())
    }
    setTurn(turn: CaptureTurn | null) {
        this.turn = turn
        if (this.attempt && this.attempt.turn.phaseId !== turn?.phaseId) this.stop()
        if (!this.attempt && !this.pending && !this.uploading && this.state.phaseId !== turn?.phaseId) {
            if (turn && this.saved.has(turn.phaseId)) this.publish('saved', 'Original saved for this turn. It cannot be replaced.', turn.phaseId)
            else this.publish('idle', turn ? 'Microphone off. Start recording when you are ready.' : 'Microphone off. Wait for your own speaking turn.', turn?.phaseId)
        }
    }
    private active(attempt: Attempt) {
        return !attempt.cancelled && this.attempt === attempt && this.turn?.phaseId === attempt.turn.phaseId && this.deps.now() < attempt.turn.observedAt + attempt.turn.remainingMs
    }
    private release(attempt: Attempt) {
        clearTimeout(attempt.timer)
        clearInterval(attempt.guard)
        attempt.stream?.getTracks().forEach((track) => track.stop())
    }
    async start() {
        const turn = this.turn
        if (!turn || this.attempt || this.pending || this.uploading || this.saved.has(turn.phaseId)) return
        const attempt: Attempt = { turn, cancelled: false }
        this.attempt = attempt
        this.publish('requesting', 'Requesting microphone permission. You can cancel before recording starts.')
        // Also bounds permission and grant waits without attempting to dismiss browser permission UI.
        attempt.timer = setTimeout(() => this.stop(), Math.max(0, Math.min(30000, turn.remainingMs - (this.deps.now() - turn.observedAt))))
        try {
            attempt.stream = await this.deps.microphone()
            if (!this.active(attempt)) { this.release(attempt); return }
            if (!await this.deps.authorize(turn)) { if (this.active(attempt)) this.stop(); return }
            if (!this.active(attempt)) return
            const grant = await this.deps.grant(turn)
            if (!this.active(attempt)) return
            if (grant.audio_available) {
                this.saved.add(turn.phaseId)
                this.release(attempt)
                this.attempt = undefined
                this.publish('saved', 'Original saved for this turn. It cannot be replaced.', turn.phaseId)
                return
            }
            // The authority read covers a phase change while the grant request was in flight.
            if (!await this.deps.authorize(turn)) { if (this.active(attempt)) this.stop(); return }
            if (!this.active(attempt)) return
            const recorder = this.deps.recorder(attempt.stream)
            attempt.recorder = recorder
            const chunks: Blob[] = []
            let size = 0
            let finished = false
            recorder.ondataavailable = (event) => {
                if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size > MAX_BYTES) this.stop() }
            }
            recorder.onerror = () => this.stop()
            recorder.onstop = () => {
                if (finished) return
                finished = true
                this.release(attempt)
                if (this.attempt === attempt) this.attempt = undefined
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
                if (!blob.size || blob.size > MAX_BYTES) { this.publish('error', 'Recording could not be saved. Keep your typed answer.', turn.phaseId); return }
                this.pending = { id: grant.recording_id, blob, phaseId: turn.phaseId }
                void this.retryUpload()
            }
            recorder.start(100)
            this.publish('recording', 'Microphone on. Stop and save when you finish.')
            let checking = false
            attempt.guard = setInterval(() => {
                if (!this.active(attempt)) { this.stop(); return }
                if (checking) return
                checking = true
                void this.deps.authorize(turn).then((allowed) => { if (!allowed && this.attempt === attempt) this.stop() }).catch(() => { if (this.attempt === attempt) this.stop() }).finally(() => { checking = false })
            }, 100)
        } catch (error) {
            this.release(attempt)
            if (this.attempt === attempt && !attempt.cancelled) {
                this.attempt = undefined
                this.publish('error', error instanceof Error ? error.message : 'Microphone unavailable. Keep your typed answer.', turn.phaseId)
            }
        } finally {
            if (!attempt.recorder && this.attempt === attempt) this.stop()
            if (!attempt.recorder || attempt.cancelled) this.release(attempt)
        }
    }
    stop = () => {
        const attempt = this.attempt
        if (!attempt || attempt.cancelled) return
        attempt.cancelled = true
        if (attempt.recorder) {
            this.publish('stopping', 'Microphone off. Finishing the original audio.')
            // stop queues the final dataavailable event before onstop. Release tracks now.
            try { if (attempt.recorder.state !== 'inactive') attempt.recorder.stop() }
            finally { this.release(attempt) }
        } else {
            this.release(attempt)
            this.attempt = undefined
            this.publish('idle', 'Microphone off. Recording request cancelled.')
        }
    }
    async retryUpload() {
        const pending = this.pending
        if (!pending || this.uploading) return
        this.uploading = true
        this.publish('saving', 'Microphone off. Saving your original audio.', pending.phaseId)
        try {
            pending.body ??= { audio_base64: await this.deps.encode(pending.blob), mime_type: pending.blob.type }
            await this.deps.upload(pending.id, pending.body)
            this.saved.add(pending.phaseId)
            this.pending = undefined
            this.uploading = false
            this.publish('saved', 'Original saved for this turn. Start manually on your next turn.', pending.phaseId)
        } catch (error) {
            this.uploading = false
            this.publish('error', `Original audio is kept for retry. ${error instanceof Error ? error.message : 'Saving failed.'}`, pending.phaseId)
        }
    }
    dispose() { this.listeners.clear(); this.turn = null; this.stop() }
}
