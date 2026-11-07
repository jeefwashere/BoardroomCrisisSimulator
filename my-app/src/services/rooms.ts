import { browserTabSession } from './tabSession.ts'
import type { TabSession } from './tabSession.ts'

export type CreateRoomInput = {
    command_id: string
    room_code: string
    display_name: string
}

export type JoinRoomInput = CreateRoomInput & { role_id?: string | null }

export type StartRoomInput = {
    command_id: string
    room_code: string
    scenario_id: string
    scenario_version: number
    timing_profile: string
    players: { member_id: string; role_id: string }[]
}

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
type RoomGame = {
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
}

export type RoomSnapshot = RoomFields & (
    { phase: 'lobby'; game: null } |
    { phase: 'briefing' | 'decision' | 'result' | 'ended'; game: RoomGame }
)

export type RoomApi = {
    initializeSession(signal?: AbortSignal): Promise<void>
    scenarios(signal?: AbortSignal): Promise<Scenario[]>
    create(input: CreateRoomInput, signal?: AbortSignal): Promise<RoomSnapshot>
    join(input: JoinRoomInput, signal?: AbortSignal): Promise<RoomSnapshot>
    snapshot(roomId: string, signal?: AbortSignal): Promise<RoomSnapshot>
    start(roomId: string, input: StartRoomInput, signal?: AbortSignal): Promise<RoomSnapshot>
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
            : ['briefing', 'decision', 'result', 'ended'].includes(String(value.phase)) && game(value.game))
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

    return {
        async initializeSession(signal) {
            await sessionToken()
            signal?.throwIfAborted()
        },
        scenarios: (signal) => request('/api/scenarios', (value): value is Scenario[] => Array.isArray(value) && value.every(scenario), signal, undefined, false),
        create: (input, signal) => request('/api/rooms', snapshot, signal, input),
        join: (input, signal) => request('/api/rooms/join', snapshot, signal, input),
        snapshot: (roomId, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}`, snapshot, signal),
        start: (roomId, input, signal) => request(`/api/rooms/${encodeURIComponent(roomId)}/start`, snapshot, signal, input),
    }
}
