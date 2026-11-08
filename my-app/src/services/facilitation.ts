// Client for docs/facilitation-api.md: AI opening briefing, adviser consultations and recorded audio.
import type { RoomApi } from './rooms.ts'

export type AdviserKind = 'facilitator' | 'it' | 'journalist'
export type JobStatus = 'pending' | 'ready' | 'failed'

export type Opening = {
    status: JobStatus
    title: string
    text: string
    source: 'hosted' | 'offline' | null
    speech_id: string | null
    error: string | null
}

export type Adviser = { kind: AdviserKind; label: string; description: string }

export type Consultation = {
    consultation_id: string
    kind: AdviserKind
    member_id: string
    round_number: number | null
    phase: string
    question: string
    status: JobStatus
    reply: string | null
    source: 'hosted' | 'offline' | null
    speech_id: string | null
    error: string | null
    at: string
}

/** Incident report attached to a room (`GET /api/rooms/{id}/facilitation` → `documents`). */
export type AttachedDocument = { document_id: string; title: string; pdf_url: string }

/** Public catalog entry (`GET /api/documents`). */
export type IncidentDocument = AttachedDocument & { filename: string; pack: string; default: boolean; summary: string }

export type Facilitation = { opening: Opening | null; advisers: Adviser[]; consultations: Consultation[]; documents?: AttachedDocument[] }

export type RecordingGroup = 'decision_guide' | 'participant' | 'facilitator' | 'adviser' | 'journalist' | 'discussion' | 'control' | 'reference'

export type RecordedClip = {
    clip_id: string
    group: RecordingGroup
    label: string
    speaker: string
    text: string
    duration_seconds: number | null
    audio_url: string
}

export type SpeechStatus = { status: 'ready' | 'disabled' | 'failed' | 'pending'; error?: string | null }

export class FacilitationError extends Error {
    readonly status: number
    constructor(message: string, status: number) { super(message); this.status = status }
}

async function json<T>(response: Response): Promise<T> {
    let payload: unknown = null
    try { payload = await response.json() } catch { /* handled below */ }
    if (!response.ok) {
        const detail = (payload as { detail?: { message?: string } } | null)?.detail
        throw new FacilitationError(detail?.message ?? `The facilitation service returned HTTP ${response.status}.`, response.status)
    }
    return payload as T
}

export function createFacilitationApi(api: RoomApi) {
    const room = (roomId: string) => `/api/rooms/${encodeURIComponent(roomId)}/facilitation`
    return {
        state: async (roomId: string, signal?: AbortSignal) => json<Facilitation>(await api.authorized(room(roomId), { signal })),
        consult: async (roomId: string, kind: AdviserKind, question: string) => json<Consultation>(await api.authorized(`${room(roomId)}/consult`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command_id: crypto.randomUUID(), kind, question }),
        })),
        prepareSpeech: async (roomId: string, speechId: string) => json<SpeechStatus>(await api.authorized(`${room(roomId)}/speech/${encodeURIComponent(speechId)}/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })),
        speechAudio: async (roomId: string, speechId: string) => {
            const response = await api.authorized(`${room(roomId)}/speech/${encodeURIComponent(speechId)}/audio`)
            if (!response.ok) throw new FacilitationError('Speech audio is unavailable.', response.status)
            return response.blob()
        },
        recordings: async (signal?: AbortSignal) => json<RecordedClip[]>(await fetch(`${api.baseUrl}/api/recordings`, { signal })),
        /** Absolute URL usable directly as an <audio src>. */
        recordingUrl: (clip: RecordedClip) => `${api.baseUrl}${clip.audio_url}`,
        /** Public catalog of the demo incident report PDFs. Throws FacilitationError (status 404) before the route exists. */
        documents: async (signal?: AbortSignal) => json<IncidentDocument[]>(await fetch(`${api.baseUrl}/api/documents`, { signal })),
        /** Absolute URL of the inline PDF, usable as a link href or viewer src. */
        documentUrl: (document: Pick<AttachedDocument, 'pdf_url'>) => /^https?:\/\//i.test(document.pdf_url) ? document.pdf_url : `${api.baseUrl}${document.pdf_url}`,
    }
}

export type FacilitationApi = ReturnType<typeof createFacilitationApi>
