// Client for docs/facilitation-api.md: AI opening briefing, adviser consultations and recorded audio.
import type { RoomApi } from './rooms.ts'

export type AdviserKind = 'facilitator' | 'it' | 'journalist'
/** Expert panel kinds used by individual decision scenarios (Cedar T01). */
export type PanelExpertKind = 'security' | 'operations' | 'governance'
/** Any expert panel kind: the legacy advisers or the newer panel experts. */
export type ExpertKind = AdviserKind | PanelExpertKind
export type JobStatus = 'pending' | 'ready' | 'failed'

export type Opening = {
    status: JobStatus
    title: string
    text: string
    source: 'vertex' | 'hosted' | 'offline' | null
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
    source: 'vertex' | 'hosted' | 'offline' | null
    speech_id: string | null
    error: string | null
    at: string
}

/** Incident report attached to a room (`GET /api/rooms/{id}/facilitation` → `documents`). */
export type AttachedDocument = { document_id: string; title: string; pdf_url: string }

/** Public catalog entry (`GET /api/documents`). */
export type IncidentDocument = AttachedDocument & { filename: string; pack: string; default: boolean; summary: string }

/** One expert's spoken take in the pre decision expert panel (facilitator, it, journalist; or security, operations, governance). */
export type ExpertTake = {
    kind: ExpertKind
    label: string
    status: JobStatus
    text: string
    source: 'vertex' | 'hosted' | 'offline' | null
    speech_id: string | null
    error: string | null
}

/** Expert panel shown between the speaking turns and voting when `game.discussion_mode === 'experts'`. */
export type ExpertPanel = { round_id: string; status: 'pending' | 'ready'; experts: ExpertTake[] }

export type Facilitation = { opening: Opening | null; advisers: Adviser[]; consultations: Consultation[]; documents?: AttachedDocument[]; expert_panel?: ExpertPanel | null }

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

// Rounds 2 and 3: one member's private branch with the crisis coach (`GET /api/rooms/{id}/private-session`).
export type PrivateStage = 'coaching' | 'card' | 'assessment' | 'complete'
export type PrivateRound = 2 | 3
export type PrivateMessage = {
    message_id: string
    author: 'agent' | 'member'
    kind: 'twist' | 'question' | 'ack' | 'update' | 'transition' | 'answer' | 'result'
    round: PrivateRound
    step: number | null
    text: string
    status: JobStatus
    source: 'vertex' | 'hosted' | 'offline' | 'canonical' | null
    speech_id: string | null
    at: string
}
export type CardFieldKey = 'action' | 'responsibility' | 'evidence' | 'dependencies' | 'fallback' | 'communication' | 'review'
export type ResponseCardFields = Record<CardFieldKey, string>
export type ResponseCard = { status: 'drafting' | 'draft' | 'confirmed'; fields: ResponseCardFields }
export type AssessmentStage = { step: number; max: number; points: number | null; status: 'waiting' | 'scoring' | 'scored' | 'failed' }
export type CriterionFeedback = { id: string; label: string; max: number; points: number; reason: string; quote: string }
export type StageFeedback = { step: number; criteria: CriterionFeedback[] }
export type Assessment = { stages: AssessmentStage[]; total: number | null; max: number; feedback: StageFeedback[] | null }
export type PrivateClip = { clip_id: string; audio_url: string; text: string; duration_seconds: number | null }
export type PrivateSession = {
    round: PrivateRound
    stage: PrivateStage
    agent: { label: string; role: 'coach' | 'examiner' }
    decision_text: string | null
    messages: PrivateMessage[]
    expecting: { round: PrivateRound; step: number; question: string } | null
    busy: boolean
    clip: PrivateClip | null
    card: ResponseCard | null
    assessment: Assessment
    retryable: boolean
}

/** A Vertex written draft reply; nothing is submitted until the member's own client commits it. */
export type AiReply = { reply_id: string; speech_id: string; mode: 'turn' | 'private'; text: string; source: string }

export type SpeechStatus = { status: 'ready' | 'disabled' | 'failed' | 'pending'; error?: string | null }

export class FacilitationError extends Error {
    readonly status: number
    /** The server's error code when it sent one (`detail.code`); absent for framework errors such as a missing route. */
    readonly code: string | null
    constructor(message: string, status: number, code: string | null = null) { super(message); this.status = status; this.code = code }
}

async function json<T>(response: Response): Promise<T> {
    let payload: unknown = null
    try { payload = await response.json() } catch { /* handled below */ }
    if (!response.ok) {
        const detail = (payload as { detail?: { message?: string; code?: string } } | null)?.detail
        const known = typeof detail === 'object' && detail !== null
        throw new FacilitationError((known && detail.message) || `The facilitation service returned HTTP ${response.status}.`, response.status, known && typeof detail.code === 'string' ? detail.code : null)
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
        /** An AI written reply for the caller to use as their own (speaking turn, or an answer to the coach); spoken in their role's voice. */
        reply: async (roomId: string, input: { mode: 'turn' | 'private'; question?: string }) => json<AiReply>(await api.authorized(`${room(roomId)}/reply`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command_id: crypto.randomUUID(), ...input }),
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
        /** The caller's own private branch (Rounds 2 and 3). The first read creates it. Throws FacilitationError 404 before the route exists. */
        privateSession: async (roomId: string, signal?: AbortSignal) => json<unknown>(await api.authorized(`/api/rooms/${encodeURIComponent(roomId)}/private-session`, { signal })),
        privateAnswer: async (roomId: string, input: { command_id: string; text: string; used_clip: boolean }, signal?: AbortSignal) => json<unknown>(await api.authorized(`/api/rooms/${encodeURIComponent(roomId)}/private-session/answer`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
        })),
        privateCard: async (roomId: string, input: { command_id: string; fields: ResponseCardFields }, signal?: AbortSignal) => json<unknown>(await api.authorized(`/api/rooms/${encodeURIComponent(roomId)}/private-session/card`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
        })),
        privateRetry: async (roomId: string, input: { command_id: string }, signal?: AbortSignal) => json<unknown>(await api.authorized(`/api/rooms/${encodeURIComponent(roomId)}/private-session/retry`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
        })),
        /** Absolute URL of the caller's saved answer clip for the current private question. */
        privateClipUrl: (clip: Pick<PrivateClip, 'audio_url'>) => /^https?:\/\//i.test(clip.audio_url) ? clip.audio_url : `${api.baseUrl}${clip.audio_url}`,
        /** Public catalog of the demo incident report PDFs. Throws FacilitationError (status 404) before the route exists. */
        documents: async (signal?: AbortSignal) => json<IncidentDocument[]>(await fetch(`${api.baseUrl}/api/documents`, { signal })),
        /** Absolute URL of the inline PDF, usable as a link href or viewer src. */
        documentUrl: (document: Pick<AttachedDocument, 'pdf_url'>) => /^https?:\/\//i.test(document.pdf_url) ? document.pdf_url : `${api.baseUrl}${document.pdf_url}`,
    }
}

export type FacilitationApi = ReturnType<typeof createFacilitationApi>
