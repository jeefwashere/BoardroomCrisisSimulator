import type { RoomSnapshot, Scenario } from '../../services/rooms.ts'
import type { RoleDraft } from '../rooms/roomState.ts'

// Three test memberships driven from one browser window. Seat IDs namespace
// each frame's tab session storage (see seatStorage in services/tabSession).
export const DEMO_SEATS = [
    { seat: 'alex', name: 'Alex' },
    { seat: 'morgan', name: 'Morgan' },
    { seat: 'sam', name: 'Sam' },
] as const

export type DemoSeat = (typeof DEMO_SEATS)[number]['seat']
export const DEMO_STORAGE_KEY = 'boardroom.demoRoom'
export const SPLIT_VIEW_MIN_WIDTH = 1400

/** Solo: the user plays Alex while Morgan and Sam are automated. Seats: one person drives all three frames. */
export type DemoMode = 'solo' | 'seats'
export const DEFAULT_DEMO_MODE: DemoMode = 'solo'
export type StoredDemo = { room_id: string; room_code: string; mode: DemoMode }

export function readStoredDemo(raw: string | null): StoredDemo | null {
    if (!raw) return null
    try {
        const value: unknown = JSON.parse(raw)
        if (typeof value !== 'object' || value === null) return null
        const { room_id: roomId, room_code: roomCode, mode } = value as Record<string, unknown>
        // Demos stored before the mode choice existed were always three seats.
        return typeof roomId === 'string' && /^[0-9a-f-]{36}$/i.test(roomId) && typeof roomCode === 'string' && /^[A-Z0-9]{6}$/.test(roomCode)
            ? { room_id: roomId, room_code: roomCode, mode: mode === 'solo' ? 'solo' : 'seats' } : null
    } catch { return null }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function demoRoomCode(random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))): string {
    return Array.from(random(6), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

export const DEMO_SCENARIO_ID = 'cedar_bridge_t01'
export type BallotSource = 'authored' | 'ai'

/** The hardcoded T01 Cedar Bridge test when the catalog lists it, else the first scenario. */
export function pickDemoScenario(catalog: readonly Scenario[]): Scenario | undefined {
    return catalog.find((scenario) => scenario.scenario_id === DEMO_SCENARIO_ID) ?? catalog[0]
}

// Seat order maps the saved T01 clips: leadership, recovery, communications.
const SEAT_ROLE_PATTERNS = [/recovery|technology|\bit\b/i, /communications?/i]

/** Alex is CEO; Morgan takes the recovery/IT role and Sam the communications role, else distinct roles in order. */
export function demoRoles(room: RoomSnapshot, memberIds: readonly string[], scenario: Scenario): RoleDraft {
    const others = scenario.roles.filter((role) => role.role_id !== 'ceo')
    if (!scenario.roles.some((role) => role.role_id === 'ceo')) throw new Error('The demo scenario has no CEO role.')
    if (others.length === 0) throw new Error('The demo scenario has no other roles to assign.')
    const chosen: string[] = []
    SEAT_ROLE_PATTERNS.forEach((pattern) => {
        const match = others.find((role) => !chosen.includes(role.role_id) && (pattern.test(role.role_id.replaceAll('_', ' ')) || pattern.test(role.name)))
        chosen.push(match?.role_id ?? '')
    })
    chosen.forEach((roleId, index) => {
        if (roleId) return
        const unused = others.find((role) => !chosen.includes(role.role_id))
        chosen[index] = unused?.role_id ?? others[index % others.length].role_id
    })
    const draft: RoleDraft = {}
    memberIds.forEach((memberId, index) => { draft[memberId] = index === 0 ? 'ceo' : chosen[(index - 1) % chosen.length] })
    // Any member who joined from elsewhere still needs a role for Start.
    room.members.forEach((member, index) => { draft[member.member_id] ??= others[index % others.length].role_id })
    return draft
}

export type SeatStatus = {
    phase: RoomSnapshot['phase'] | null
    roleId: string | null
    speaking: boolean
    decide: boolean
    voted: boolean
    ceoTie: boolean
}

export function seatStatus(snapshot: RoomSnapshot | null | undefined): SeatStatus {
    if (!snapshot) return { phase: null, roleId: null, speaking: false, decide: false, voted: false, ceoTie: false }
    const self = snapshot.members.find((member) => member.member_id === snapshot.self_member_id)
    const roleId = self?.role_id ?? null
    const game = snapshot.game
    const eligible = Boolean(game && (game.allowed_actions?.includes('vote') ?? game.eligible_member_ids.includes(snapshot.self_member_id)))
    const voting = snapshot.phase === 'voting' && eligible
    return {
        phase: snapshot.phase,
        roleId,
        speaking: snapshot.phase === 'speaking' && game?.active_speaker_id === snapshot.self_member_id,
        decide: voting && game?.self_vote == null,
        voted: voting && game?.self_vote != null,
        ceoTie: snapshot.phase === 'tie_break' && roleId === 'ceo',
    }
}

/**
 * Which seat the single window view should show, mirroring the playtest:
 * the current speaker, then the next member who still has to vote in seat
 * order (the CEO once everyone voted), and the CEO during a tie break.
 * Returns null when the phase does not call for a specific seat.
 */
export function followTarget(snapshots: readonly (RoomSnapshot | null | undefined)[]): number | null {
    const statuses = snapshots.map(seatStatus)
    const phase = statuses.find((status) => status.phase)?.phase ?? null
    const ceo = statuses.findIndex((status) => status.roleId === 'ceo')
    if (phase === 'speaking') {
        const speaker = statuses.findIndex((status) => status.speaking)
        return speaker >= 0 ? speaker : null
    }
    if (phase === 'voting') {
        const next = statuses.findIndex((status) => status.decide)
        return next >= 0 ? next : ceo >= 0 ? ceo : null
    }
    if (phase === 'tie_break') return ceo >= 0 ? ceo : null
    return null
}

export function phaseLabel(phase: SeatStatus['phase']): string {
    return phase ? phase.replaceAll('_', ' ') : 'connecting'
}

// ---------------------------------------------------------------------------
// Solo mode: Morgan and Sam are bots driven by the parent demo page.
// ---------------------------------------------------------------------------

export type BotSeat = 'morgan' | 'sam'
export type DemoBot = {
    seat: BotSeat
    /** Index into DEMO_SEATS and the parent page's snapshot list. */
    index: 1 | 2
    name: string
    title: string
    /** Ballot words this bot leans towards; a label hit counts double a description hit. */
    keywords: readonly RegExp[]
    /** Committed when the bot's saved clip is missing from the recordings catalog. */
    fallback: string
}

export const DEMO_BOTS: readonly DemoBot[] = [
    {
        seat: 'morgan', index: 1, name: 'Morgan', title: 'IT recovery lead',
        keywords: [/technical/i, /verif/i, /check/i, /\bIT\b/, /backup/i, /recover/i],
        fallback: 'From IT recovery: before we promise anything, we verify the backups are usable, map the recovery dependencies and get a restoration estimate.',
    },
    {
        seat: 'sam', index: 2, name: 'Sam', title: 'Communications lead',
        keywords: [/update/i, /communicat/i, /public/i, /continuity/i],
        fallback: 'From communications: we issue a factual update now that separates confirmed facts from unknowns and commits to a time for the next update.',
    },
]

export type BallotChoice = { option_id: string; label: string; kind?: string; member_id?: string | null; description?: string | null }

/** Keyword affinity of one ballot option for a bot: 2 per keyword in the label, else 1 if it is in the description. */
export function keywordScore(option: BallotChoice, keywords: readonly RegExp[]): number {
    return keywords.reduce((score, keyword) => score + (keyword.test(option.label) ? 2 : keyword.test(option.description ?? '') ? 1 : 0), 0)
}

/** FNV-1a; stable across browsers so a room replays the same bot behaviour. */
export function seededHash(key: string): number {
    let hash = 0x811c9dc5
    for (let index = 0; index < key.length; index++) {
        hash ^= key.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash
}

/** Roughly one bot in three backs the CEO regardless of keywords, seeded by room so it is reproducible. */
export function backsCeoByChance(roomId: string, seat: BotSeat): boolean {
    return seededHash(`${roomId}:${seat}`) % 3 === 0
}

export type BotVoteInput = {
    bot: DemoBot
    options: readonly BallotChoice[]
    /** The CEO's (Alex's) current ballot. */
    ceoVote: string | null | undefined
    ceoMemberId: string
    roomId: string
}

/**
 * The bot's ballot. The CEO's choice is Alex's vote (or, failing that, Alex's own custom option).
 * Keyword preference only considers authored and AI options: custom options are reached only
 * by backing the CEO, so a custom option Alex proposed counts as the CEO's choice.
 * No keyword match, or the seeded 1 in 3 chance, backs the CEO's choice.
 */
export function botVoteChoice({ bot, options, ceoVote, ceoMemberId, roomId }: BotVoteInput): string | null {
    const ids = new Set(options.map((option) => option.option_id))
    const ceoChoice = ceoVote && ids.has(ceoVote) ? ceoVote
        : options.find((option) => option.kind === 'custom' && option.member_id === ceoMemberId)?.option_id ?? null
    if (ceoChoice && backsCeoByChance(roomId, bot.seat)) return ceoChoice
    let best: { id: string; score: number } | null = null
    for (const option of options) {
        if (option.kind === 'custom') continue
        const score = keywordScore(option, bot.keywords)
        if (score > 0 && (!best || score > best.score)) best = { id: option.option_id, score }
    }
    return best?.id ?? ceoChoice ?? options.find((option) => option.kind !== 'custom')?.option_id ?? null
}

type Snapshot = RoomSnapshot | null | undefined

export type BotAction = { kind: 'speak' | 'vote'; bot: DemoBot; phaseId: string; roundId: string; key: string }

/** The bot's own live speaking turn, read from that bot's snapshot. */
export function botSpeakingTurn(bot: DemoBot, snapshot: Snapshot): Omit<BotAction, 'kind' | 'key'> | null {
    const game = snapshot?.game
    if (!snapshot || !game || snapshot.phase !== 'speaking' || !game.active_speaker_id || game.active_speaker_id !== snapshot.self_member_id) return null
    if (game.allowed_actions && !game.allowed_actions.includes('finish_speaking')) return null
    return { bot, phaseId: game.phase_id, roundId: game.round_id }
}

/**
 * Which bot acts now, given every seat's snapshot (Alex first) and the action keys already taken.
 * A bot speaks on its own turn. Bots vote only after the CEO's ballot is in, Morgan before Sam,
 * and each bot votes at most once per voting phase (a later CEO vote change does not re vote).
 */
export function nextBotAction(snapshots: readonly Snapshot[], handled: ReadonlySet<string>): BotAction | null {
    for (const bot of DEMO_BOTS) {
        const turn = botSpeakingTurn(bot, snapshots[bot.index])
        const key = turn && `speak:${turn.phaseId}:${bot.seat}`
        if (turn && key && !handled.has(key)) return { kind: 'speak', key, ...turn }
    }
    const ceo = snapshots[0]
    if (ceo?.phase !== 'voting' || ceo.game.self_vote == null) return null
    for (const bot of DEMO_BOTS) {
        const own = snapshots[bot.index]
        const game = own?.game
        if (!own || !game || own.phase !== 'voting' || game.phase_id !== ceo.game.phase_id || game.self_vote != null) continue
        if (game.allowed_actions && !game.allowed_actions.includes('vote')) continue
        const key = `vote:${game.phase_id}:${bot.seat}`
        if (!handled.has(key)) return { kind: 'vote', bot, phaseId: game.phase_id, roundId: game.round_id, key }
    }
    return null
}

/** How long a bot may let its clip run before it must commit and pass, leaving margin before the turn deadline. */
export function turnBudgetMs(game: { phase_deadline?: string | null; server_time?: string } | null | undefined, fallbackMs = 25000): number {
    const deadline = game?.phase_deadline ? Date.parse(game.phase_deadline) : NaN
    const now = game?.server_time ? Date.parse(game.server_time) : NaN
    if (!Number.isFinite(deadline) || !Number.isFinite(now)) return fallbackMs
    return Math.max(1000, deadline - now - 3000)
}

/** What the parent page is doing for a bot right now (not visible in any snapshot). */
export type BotActivity = 'clip' | 'fallback' | 'committing' | 'deciding'

/** Status shown in the solo Board strip for one bot. */
export function botStatusText(bot: DemoBot, snapshots: readonly Snapshot[], activity: BotActivity | null | undefined): string {
    if (activity === 'clip') return 'speaking (playing saved clip)…'
    if (activity === 'fallback') return 'speaking…'
    if (activity === 'committing') return 'passing the turn…'
    if (activity === 'deciding') return 'deciding…'
    const own = snapshots[bot.index]
    if (!own) return 'connecting…'
    const self = own.members.find((member) => member.member_id === own.self_member_id)
    if (self && !self.connected) return 'reconnecting…'
    const game = own.game
    if (!game) return 'waiting'
    if (own.phase === 'speaking' && game.active_speaker_id === own.self_member_id) return 'speaking…'
    const turn = (game.turns ?? []).findLast((item) => item.member_id === own.self_member_id && item.round_id === game.round_id)
    if (['speaking', 'discussion'].includes(own.phase) && turn) return turn.reason === 'finished' ? 'spoke' : turn.reason === 'disconnected' ? 'skipped (disconnected)' : 'turn ended'
    if (game.self_vote != null && ['voting', 'tie_break', 'resolving', 'resolution_failed', 'decision', 'result', 'ended'].includes(own.phase)) return 'voted'
    if (own.phase === 'voting') return snapshots[0]?.game?.self_vote == null ? 'waiting for your vote' : 'waiting'
    return 'waiting'
}

export function botStatusLine(bot: DemoBot, snapshots: readonly Snapshot[], activity: BotActivity | null | undefined): string {
    return `${bot.name} · ${bot.title} — ${botStatusText(bot, snapshots, activity)}`
}

export type SoloStage = {
    text: string
    /** 'record': the CEO can close voting and record the final decision now. */
    action: 'record' | null
    /** The adopted option once the decision is recorded. */
    decision: string | null
    over: boolean
}

/** The solo bar's headline: what Alex should do next, the record call to action, and the final decision. */
export function soloStage(snapshots: readonly Snapshot[]): SoloStage {
    const stage = (text: string, extra: Partial<SoloStage> = {}): SoloStage => ({ text, action: null, decision: null, over: false, ...extra })
    const ceo = snapshots[0]
    if (!ceo) return stage('Connecting…')
    if (ceo.phase === 'lobby') return stage('Lobby: assign roles and start the game in your view')
    const game = ceo.game
    const label = game.last_result?.round_number === game.round_number ? game.last_result.selected_option_label : null
    switch (ceo.phase) {
        case 'briefing':
        case 'reading': return stage('Opening briefing: listen in your view, or use Skip phase')
        case 'speaking': {
            if (game.active_speaker_id === ceo.self_member_id) return stage('Your turn: speak or play your clip, then finish your turn')
            const speaker = ceo.members.find((member) => member.member_id === game.active_speaker_id)
            return stage(speaker ? `${speaker.display_name} has the floor` : 'Speaking turns')
        }
        case 'discussion': return stage(game.discussion_mode === 'experts' ? 'Expert panel: voting opens when the experts finish' : 'Open discussion before the vote')
        case 'voting': {
            if (game.self_vote == null) return stage('Your decision first: vote in your view (you may add your own option)')
            const botsVoted = DEMO_BOTS.every((bot) => snapshots[bot.index]?.game?.self_vote != null)
            if (!botsVoted) return stage('The board is deciding…')
            const canRecord = game.allowed_actions?.includes('skip_phase') ?? false
            return stage(canRecord ? 'The board has voted: record the final decision' : 'The board has voted', { action: canRecord ? 'record' : null })
        }
        case 'tie_break': return stage('Tie — choose the final decision in your view')
        case 'resolving': return stage('Evaluating the custom decision…')
        case 'resolution_failed': return stage('The custom decision could not be evaluated: retry in your view')
        case 'decision': return stage('Recording the decision…')
        case 'result': return stage('Decision recorded', { decision: label })
        case 'ended': {
            const final = label ?? game.last_result?.selected_option_label ?? null
            return stage(game.last_result ? 'Decision recorded · game over' : 'Game over', { decision: final, over: true })
        }
    }
}
