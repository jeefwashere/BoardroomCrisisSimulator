import { browserTabSession } from './tabSession.ts'
import type { TabSession } from './tabSession.ts'

export type CreateRoomInput = {
    command_id: string
    room_code: string
    display_name: string
}

export type JoinRoomInput = CreateRoomInput & { role_id?: string | null }

export type LeaveRoomInput = { command_id: string }
export type LeaveReceipt = { room_id: string; room_version: number; status: 'left' | 'closed' }

export type ContributionInput = {
    command_id: string
    phase_id: string | null
    kind: 'answer' | 'chat'
    source: 'typed' | 'speech'
    text: string
}

export type Contribution = {
    contribution_id: string
    sequence: number
    member_id: string
    role_id: string | null
    phase_id: string | null
    phase: string
    round_id: string | null
    round_number: number | null
    node_id: string | null
    kind: ContributionInput['kind']
    source: ContributionInput['source']
    text: string
    at: string
}

export type StartRoomInput = {
    command_id: string
    room_code: string
    scenario_id: string
    scenario_version: number
    timing_profile: string
    players: { member_id: string; role_id: string }[]
    /** Optional: authored fixed choices or AI generated voting options. */
    ballot_source?: 'ai' | 'authored'
    /** Untimed speaking turns (three window demo): each turn lasts until the speaker finishes or the host skips. */
    manual_turns?: boolean
    /** Test shortcut: "assessment" opens straight on Round 3 (Rounds 1 and 2 filled from the prerecorded answers). */
    start_at?: StartAt
}

export type StartAt = 'beginning' | 'assessment'

type ScenarioReference = {
    scenario_id: string
    version: number
    title: string
    content_sha256: string
}

export type Scenario = ScenarioReference & {
    roles: { role_id: string; name: string }[]
    timings: { profile_id: string; briefing_seconds: number }[]
}

export type RoomMember = {
    member_id: string
    display_name: string
    is_host: boolean
    connected: boolean
    role_id: string | null
    eligible_from_round: number | null
    eligible_current_round: boolean
}

type RoomFields = {
    room_id: string
    room_code: string
    room_version: number
    capacity: 30
    presence_window_seconds: 30
    host_member_id: string
    self_member_id: string
    members: RoomMember[]
}

// Public projection used by the lobby and briefing. Other server game fields
// remain server owned and can be added here when a screen needs them.
export type RoomGame = {
    phase_id: string
    round_id: string
    round_number: number
    started_at: string
    scenario: ScenarioReference
    timing_profile: string
    briefing_seconds: number
    result_seconds: number
    initial_node_id: string
    facts: Record<string, string | number | boolean | null>
    public_documents: { id: string; text: string }[]
    eligible_member_ids: string[]
    ending_label: string | null
    server_time?: string
    phase_deadline?: string | null
    session_deadline?: string | null
    active_speaker_id?: string | null
    speaker_order?: string[]
    /** Index into `speaker_order` of the active speaking turn (Cedar loops the order, so members repeat). */
    speaker_index?: number | null
    /** True when speaking turns are untimed (see `StartInput.manual_turns`). */
    manual_turns?: boolean
    /** The saved clip the active speaker started, so every window plays it from the same moment. */
    speaker_clip?: { clip_id: string; started_at: string; text?: string | null } | null
    /** Open floor rooms: nobody holds the floor, and any member may take it (`take_floor` in allowed_actions). */
    floor_open?: boolean
    /** Open floor rooms: who held the floor last; they cannot take it again until someone else has spoken. */
    last_speaker_id?: string | null
    self_vote?: string | null
    vote_counts?: Record<string, number> | null
    tied_option_ids?: string[]
    allowed_actions?: string[]
    current_node?: { node_id: string; title: string; situation: string; study_questions: string[]; options: { option_id: string; label: string; kind?: 'prepared' | 'custom' | 'ai'; member_id?: string | null; description?: string | null; rationale?: string | null }[] } | null
    ballot_source?: 'ai' | 'authored'
    options_source?: 'ai' | 'prepared_fallback' | 'authored'
    ai_options_status?: 'pending' | 'ready' | 'failed' | 'disabled'
    history?: Decision[]
    last_result?: Decision | null
    turns?: { member_id: string; phase_id: string; round_id: string; reason: string; started_at: string; ended_at: string }[]
    narration?: { narration_id: string; phase_id: string; text: string } | null
    proposals?: { option_id: string; member_id: string; text: string }[]
    resolution?: { status: string; error: string | null; attempts: number } | null
    feedback?: { status: string; text: string; error: string | null } | null
    discussion_mode?: 'open' | 'experts'
    /** "vote": board ballot (default). "individual": each member writes their own decision instead (Cedar T01). */
    decision_mode?: 'vote' | 'individual'
    individual_decisions?: IndividualDecisions | null
    /** Rounds 2 and 3 (private coaching, then private assessment) follow the individual decisions. */
    private_rounds?: boolean
    /** Readable ending heading, e.g. "Private sessions complete". */
    ending_title?: string | null
    private_progress?: PrivateProgress[]
    /** Where the game started: the briefing (default) or straight at the Round 3 assessment. */
    start_at?: StartAt
}
export type PrivateProgressStage = 'not_started' | 'coaching' | 'card' | 'assessment' | 'complete'
/** Each member's private session stage; never their answers. */
export type PrivateProgress = { member_id: string; display_name: string; role_name: string; stage: PrivateProgressStage }
export type IndividualDecisions = {
    /** Who has submitted; other members' texts are never projected. */
    submitted: { member_id: string; display_name: string; role_name: string; submitted: boolean }[]
    /** The caller's own latest decision. */
    self: { text: string; at: string } | null
}
export type Decision = { decision_id: string; round_number: number; question: string; selected_option_label: string | null; text: string; selection_method: string; vote_counts: Record<string, number> }
export type Recording = { recording_id: string; member_id: string; round_id?: string | null; round_number: number; phase_id: string; status: string; transcript: string; reviewed_text: string | null; error: string | null; mime_type: string | null; audio_available: boolean; started_at?: string; duration_seconds?: number | null; ended_at?: string | null }
export type Extras = { feedback?: { status: string; text: string; error: string | null; completed_parts: number; total_parts: number; evidence_refs?: { id: string; label: string; assessment: string; criterion: string; quote: string; fragment: number }[] }; recordings: Recording[]; contributions: { member_id: string; round_number: number | null; text: string; kind: string }[] }


export type RoomSnapshot = RoomFields & (
    { phase: 'lobby'; game: null } |
    { phase: 'briefing' | 'reading' | 'speaking' | 'discussion' | 'individual_decision' | 'private_session' | 'voting' | 'tie_break' | 'resolving' | 'resolution_failed' | 'decision' | 'result' | 'ended'; game: RoomGame }
)

export type RoomApi = {
    command(roomId: string, path: string, input: object, signal?: AbortSignal): Promise<RoomSnapshot>
    extras(roomId: string, signal?: AbortSignal): Promise<Extras>
    recordings(roomId: string, signal?: AbortSignal): Promise<Recording[]>
    mediaPost(roomId: string, path: string, input: object, signal?: AbortSignal): Promise<Recording>
    /** Dictation: one short clip transcribed by the server (ElevenLabs Scribe); nothing is stored. */
    dictate(roomId: string, clip: { audio_base64: string; mime_type: string }, signal?: AbortSignal): Promise<string>
    audio(roomId: string, recordingId: string, signal?: AbortSignal): Promise<Blob>
    prepareNarration(roomId: string, narrationId: string): Promise<{ status: string; error?: string }>
    narrationEvent(roomId: string, narrationId: string, event: string): Promise<{ status: string }>
    narration(roomId: string, narrationId: string, signal?: AbortSignal): Promise<Blob>
    initializeSession(signal?: AbortSignal): Promise<void>
    scenarios(signal?: AbortSignal): Promise<Scenario[]>
    create(input: CreateRoomInput, signal?: AbortSignal): Promise<RoomSnapshot>
    join(input: JoinRoomInput, signal?: AbortSignal): Promise<RoomSnapshot>
    leave(roomId: string, input: LeaveRoomInput, signal?: AbortSignal): Promise<LeaveReceipt>
    snapshot(roomId: string, signal?: AbortSignal): Promise<RoomSnapshot>
    start(roomId: string, input: StartRoomInput, signal?: AbortSignal): Promise<RoomSnapshot>
    contributions(roomId: string, signal?: AbortSignal): Promise<Contribution[]>
    contribute(roomId: string, input: ContributionInput, signal?: AbortSignal): Promise<Contribution>
    /** Authenticated raw request to the backend; used by feature clients such as facilitation. */
    authorized(path: string, init?: RequestInit): Promise<Response>
    readonly baseUrl: string
}

type ValidationDetail = { loc: (string | number)[]; msg: string; type: string }

export class RoomApiError extends Error {
    readonly status: number | null
    readonly code: string
    readonly details: ValidationDetail[]

    constructor(message: string, code: string, status: number | null, details: ValidationDetail[] = []) {
        super(message)
        this.name = 'RoomApiError'
        this.status = status
        this.code = code
        this.details = details
    }
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function scenarioReference(value: unknown): boolean {
    return record(value) && typeof value.scenario_id === 'string' && Number.isInteger(value.version)
        && typeof value.title === 'string' && typeof value.content_sha256 === 'string'
}

function scenario(value: unknown): value is Scenario {
    return scenarioReference(value) && record(value)
        && Array.isArray(value.roles) && value.roles.every((role: unknown) => record(role)
            && typeof role.role_id === 'string' && typeof role.name === 'string')
        && Array.isArray(value.timings) && value.timings.every((timing: unknown) => record(timing)
            && typeof timing.profile_id === 'string' && Number.isInteger(timing.briefing_seconds))
}

function member(value: unknown): value is RoomMember {
    return record(value) && typeof value.member_id === 'string' && typeof value.display_name === 'string'
        && typeof value.is_host === 'boolean' && typeof value.connected === 'boolean'
        && (value.role_id === null || typeof value.role_id === 'string')
        && (value.eligible_from_round === null || Number.isInteger(value.eligible_from_round))
        && typeof value.eligible_current_round === 'boolean'
}

function contribution(value: unknown): value is Contribution {
    return record(value) && typeof value.contribution_id === 'string'
        && Number.isInteger(value.sequence) && Number(value.sequence) >= 1
        && typeof value.member_id === 'string' && (value.role_id === null || typeof value.role_id === 'string')
        && (value.phase_id === null || typeof value.phase_id === 'string') && typeof value.phase === 'string'
        && (value.round_id === null || typeof value.round_id === 'string')
        && (value.round_number === null || (Number.isInteger(value.round_number) && Number(value.round_number) >= 1))
        && (value.node_id === null || typeof value.node_id === 'string')
        && (value.kind === 'answer' || value.kind === 'chat') && (value.source === 'typed' || value.source === 'speech')
        && typeof value.text === 'string' && typeof value.at === 'string'
}

function recording(value: unknown): value is Recording {
    return record(value) && typeof value.recording_id === 'string' && typeof value.member_id === 'string'
        && (value.round_id === undefined || value.round_id === null || typeof value.round_id === 'string')
        && Number.isInteger(value.round_number) && typeof value.phase_id === 'string' && typeof value.status === 'string'
        && typeof value.transcript === 'string' && (value.reviewed_text === null || typeof value.reviewed_text === 'string')
        && (value.error === null || typeof value.error === 'string') && (value.mime_type === null || typeof value.mime_type === 'string')
        && typeof value.audio_available === 'boolean'
        && (value.started_at === undefined || typeof value.started_at === 'string')
        && (value.duration_seconds === undefined || value.duration_seconds === null || typeof value.duration_seconds === 'number')
        && (value.ended_at === undefined || value.ended_at === null || typeof value.ended_at === 'string')
}

function game(value: unknown): value is RoomGame {
    return record(value) && typeof value.phase_id === 'string' && typeof value.round_id === 'string'
        && Number.isInteger(value.round_number) && typeof value.started_at === 'string'
        && scenarioReference(value.scenario) && typeof value.timing_profile === 'string'
        && Number.isInteger(value.briefing_seconds) && Number.isInteger(value.result_seconds)
        && typeof value.initial_node_id === 'string' && record(value.facts)
        && Object.values(value.facts).every((fact) => fact === null || typeof fact === 'string'
            || typeof fact === 'boolean' || typeof fact === 'number')
        && Array.isArray(value.public_documents) && value.public_documents.every((document: unknown) => record(document)
            && typeof document.id === 'string' && typeof document.text === 'string')
        && strings(value.eligible_member_ids) && (value.ending_label === null || typeof value.ending_label === 'string')
}

function snapshot(value: unknown): value is RoomSnapshot {
    return record(value) && typeof value.room_id === 'string' && typeof value.room_code === 'string'
        && Number.isInteger(value.room_version) && value.capacity === 30 && value.presence_window_seconds === 30
        && typeof value.host_member_id === 'string' && typeof value.self_member_id === 'string'
        && Array.isArray(value.members) && value.members.every(member)
        && (value.phase === 'lobby' ? value.game === null
            : ['briefing', 'reading', 'speaking', 'discussion', 'individual_decision', 'private_session', 'voting', 'tie_break', 'resolving', 'resolution_failed', 'decision', 'result', 'ended'].includes(String(value.phase)) && game(value.game))
}

function cleanMessage(value: string): string {
    return Array.from(value).filter((character) => character >= ' ' && character !== '\u007f').join('').trim().slice(0, 1000)
}

function responseError(payload: unknown, status: number): RoomApiError {
    const detail = record(payload) ? payload.detail : undefined
    if (record(detail) && typeof detail.code === 'string' && typeof detail.message === 'string') {
        return new RoomApiError(cleanMessage(detail.message), cleanMessage(detail.code), status)
    }
    if (Array.isArray(detail)) {
        // Retain actionable field information, never echo submitted input or ctx.
        const details = detail.filter(record).map((item) => ({
            loc: Array.isArray(item.loc) ? item.loc.filter((part): part is string | number =>
                typeof part === 'string' || typeof part === 'number') : [],
            msg: typeof item.msg === 'string' ? cleanMessage(item.msg) : 'Invalid value',
            type: typeof item.type === 'string' ? cleanMessage(item.type) : 'validation_error',
        }))
        const message = details.map((item) => `${item.loc.join('.')}: ${item.msg}`).join('; ')
        return new RoomApiError(message || 'The request failed validation.', 'validation_error', status, details)
    }
    return new RoomApiError(`The room service returned HTTP ${status}.`, 'http_error', status)
}

function aborted(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

export function createRoomApi(options: { baseUrl?: string; fetch?: typeof globalThis.fetch; session?: TabSession } = {}): RoomApi {
    const environment = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env
    const baseUrl = (options.baseUrl ?? environment?.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')
    const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis)

    const session = options.session ?? browserTabSession()

    async function sessionToken(): Promise<string> {
        return session.token(async (previous) => {
            const result = await request('/api/tab-sessions', (value): value is { status: 'ready'; session_token: string } =>
                record(value) && value.status === 'ready' && typeof value.session_token === 'string' && value.session_token.length > 0,
                undefined, { session_token: previous }, false)
            return result.session_token
        })
    }

    async function request<T>(path: string, validate: (value: unknown) => value is T, signal?: AbortSignal, body?: object, authenticated = true): Promise<T> {
        const token = authenticated ? await sessionToken() : undefined
        signal?.throwIfAborted()
        let response: Response
        try {
            response = await fetchRequest(`${baseUrl}${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                credentials: 'include',
                signal,
                headers: { ...(token ? { 'X-Boardroom-Session': token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        } catch (error) {
            if (aborted(error, signal)) throw error
            throw new RoomApiError('The room service could not be reached. Check the connection and API address.', 'network_error', null)
        }
        let payload: unknown
        try {
            payload = await response.json()
        } catch (error) {
            if (aborted(error, signal)) throw error
            if (!response.ok) throw responseError(null, response.status)
            throw new RoomApiError('The room service returned invalid JSON.', 'invalid_response', response.status)
        }
        if (!response.ok) throw responseError(payload, response.status)
        if (!validate(payload)) throw new RoomApiError('The room service returned an unexpected response.', 'invalid_response', response.status)
        return payload
    }

    async function bytes(path: string, signal?: AbortSignal): Promise<Blob> {
        const token = await sessionToken()
        const response = await fetchRequest(`${baseUrl}${path}`, { headers: { 'X-Boardroom-Session': token }, signal })
        if (!response.ok) throw new RoomApiError('Audio is unavailable.', 'audio_unavailable', response.status)
        return response.blob()
    }
    return {
        command: async (roomId, path, input, signal) => {
            if (path === 'contributions') {
                await request(`/api/rooms/${encodeURIComponent(roomId)}/${path}`, (value): value is { contribution_id: string } => record(value) && typeof value.contribution_id === 'string', signal, input)
                return request(`/api/rooms/${encodeURIComponent(roomId)}`, snapshot, signal)
            }
            return request(`/api/rooms/${encodeURIComponent(roomId)}/${path}`, snapshot, signal, input)
        },
        extras: (roomId, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}/extras`, (value): value is Extras => record(value) && Array.isArray(value.recordings) && Array.isArray(value.contributions), signal),
        recordings: (roomId, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}/recordings`, (value): value is Recording[] => Array.isArray(value) && value.every(recording), signal),
        mediaPost: (roomId, path, input, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}/${path}`, (value): value is Recording => record(value) && typeof value.recording_id === 'string' && typeof value.status === 'string', signal, input),
        dictate: async (roomId, clip, signal) => (await request(`/api/rooms/${encodeURIComponent(roomId)}/dictation`, (value): value is { text: string } => record(value) && typeof value.text === 'string', signal, clip)).text,
        audio: (roomId, recordingId, signal) => bytes(`/api/rooms/${encodeURIComponent(roomId)}/recordings/${encodeURIComponent(recordingId)}/audio`, signal),
        prepareNarration: (roomId, id) => request(`/api/rooms/${encodeURIComponent(roomId)}/narration/${encodeURIComponent(id)}/prepare`, (value): value is { status: string; error?: string } => record(value) && typeof value.status === 'string', undefined, {}),
        narrationEvent: (roomId, id, event) => request(`/api/rooms/${encodeURIComponent(roomId)}/narration/${encodeURIComponent(id)}/delivery`, (value): value is { status: string } => record(value) && typeof value.status === 'string', undefined, { event }),
        narration: (roomId, narrationId, signal) => bytes(`/api/rooms/${encodeURIComponent(roomId)}/narration/${encodeURIComponent(narrationId)}/audio`, signal),
        async initializeSession(signal) {
            await sessionToken()
            signal?.throwIfAborted()
        },
        scenarios: (signal) => request('/api/scenarios', (value): value is Scenario[] => Array.isArray(value) && value.every(scenario), signal, undefined, false),
        create: (input, signal) => request('/api/rooms', snapshot, signal, input),
        join: (input, signal) => request('/api/rooms/join', snapshot, signal, input),
        leave: (roomId, input, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}/leave`, (value): value is LeaveReceipt =>
            record(value) && value.room_id === roomId && Number.isInteger(value.room_version)
            && Number(value.room_version) >= 1 && (value.status === 'left' || value.status === 'closed'), signal, input),
        snapshot: (roomId, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}`, snapshot, signal),
        start: (roomId, input, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}/start`, snapshot, signal, input),
        contributions: (roomId, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}/contributions`,
            (value): value is Contribution[] => Array.isArray(value) && value.every(contribution), signal),
        contribute: (roomId, input, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}/contributions`, contribution, signal, input),
        async authorized(path, init = {}) {
            const token = await sessionToken()
            return fetchRequest(`${baseUrl}${path}`, { credentials: 'include', ...init, headers: { 'X-Boardroom-Session': token, ...(init.headers ?? {}) } })
        },
        baseUrl,
    }
}
