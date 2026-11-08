import type { RoomSnapshot, Scenario } from '../../services/rooms.ts'
import type { RoleDraft } from '../rooms/roomState.ts'
import { progressStatus } from '../game/privateSessionModel.ts'
import { STAGE_STORAGE_KEY } from '../boardroom3d/boardroomModel.ts'

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

/**
 * Solo: the user plays Alex while Morgan and Sam are automated. Seats: one person drives all three frames.
 * Windows: three independent windows (or devices); Alex hosts here and Morgan and Sam join from their own links.
 */
export type DemoMode = 'solo' | 'seats' | 'windows'
export const DEFAULT_DEMO_MODE: DemoMode = 'solo'
export type StoredDemo = { room_id: string; room_code: string; mode: DemoMode; ballot?: BallotSource }

/** Solo stage: the 3D boardroom (default) or the call tiles. Shares the in game switch's choice for this tab. */
export type DemoView = '3d' | 'call'
export const DEMO_VIEW_KEY = STAGE_STORAGE_KEY
export function readDemoView(raw: string | null): DemoView {
    return raw === 'call' ? 'call' : '3d'
}

/** Alex's frame in the solo demo; `view=3d` makes the game screen use the 3D boardroom stage. */
export function soloFrameSrc(pathname: string, roomId: string, view: DemoView): string {
    return `${pathname}?seat=${DEMO_SEATS[0].seat}${view === '3d' ? '&view=3d' : ''}#/room/${roomId}`
}

export function readStoredDemo(raw: string | null): StoredDemo | null {
    if (!raw) return null
    try {
        const value: unknown = JSON.parse(raw)
        if (typeof value !== 'object' || value === null) return null
        const { room_id: roomId, room_code: roomCode, mode, ballot } = value as Record<string, unknown>
        // Demos stored before the mode choice existed were always three seats.
        return typeof roomId === 'string' && /^[0-9a-f-]{36}$/i.test(roomId) && typeof roomCode === 'string' && /^[A-Z0-9]{6}$/.test(roomCode)
            ? { room_id: roomId, room_code: roomCode, mode: mode === 'solo' || mode === 'windows' ? mode : 'seats', ...(ballot === 'ai' || ballot === 'authored' ? { ballot } : {}) } : null
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
    const writing = snapshot.phase === 'individual_decision' && Boolean(game?.allowed_actions?.includes('submit_decision')) && !game?.individual_decisions?.self
    return {
        phase: snapshot.phase,
        roleId,
        speaking: snapshot.phase === 'speaking' && game?.active_speaker_id === snapshot.self_member_id,
        decide: (voting && game?.self_vote == null) || writing,
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
    if (phase === 'individual_decision') {
        const next = statuses.findIndex((status) => status.decide)
        return next >= 0 ? next : null
    }
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
    /** Submitted as this bot's own written decision in individual decision games. */
    decision: string
    /** Short answers in its private session when no saved clip is offered: coaching (Round 2) and assessment (Round 3). */
    privateAnswers: { coaching: string; assessment: string }
}

export const DEMO_BOTS: readonly DemoBot[] = [
    {
        seat: 'morgan', index: 1, name: 'Morgan', title: 'IT recovery lead',
        keywords: [/technical/i, /verif/i, /check/i, /\bIT\b/, /backup/i, /recover/i],
        fallback: 'From IT recovery: before we promise anything, we verify the backups are usable, map the recovery dependencies and get a restoration estimate.',
        privateAnswers: {
            coaching: 'I would ask the alternate provider to confirm their availability and access needs, check the delegation policy for who can authorize access, and keep restoring from verified backups only.',
            assessment: 'First, the authorized deputy approves the alternate provider\'s access while my team verifies backups. If the provider is delayed, staff use the paper appointment process. I will review progress at the next update in two hours.',
        },
        decision: 'I would verify that our backups are usable and map the recovery dependencies before we promise any restoration time, because a missed promise would cost more trust than a short delay. Using the IT status report (systems down, backups not yet test restored, vendor dependencies unconfirmed), I would run a test restore first. I still need to establish whether the latest backup is clean and complete, how long a restore takes and which systems must come back first.',
    },
    {
        seat: 'sam', index: 2, name: 'Sam', title: 'Communications lead',
        keywords: [/update/i, /communicat/i, /public/i, /continuity/i],
        fallback: 'From communications: we issue a factual update now that separates confirmed facts from unknowns and commits to a time for the next update.',
        privateAnswers: {
            coaching: 'I would tell staff and clients what is confirmed, what is still unknown and when the next update comes, and ask the authorized deputy to approve the wording.',
            assessment: 'First, the deputy approves a short update to staff and clients separating facts from unknowns. If the provider cannot start, staff follow the paper process and we say so. I will review and send the next update in two hours.',
        },
        decision: 'I would publish an honest update now that separates confirmed facts from unknowns and names the time of the next update, because silence invites rumours while a scheduled update shows control without overpromising. Using what is confirmed so far (the affected services, the approved paper appointment workaround and the recovery checks under way), I would keep it short. I still need to establish the restoration estimate, whether any personal data was exposed and who approves the wording while the director is unavailable.',
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

export type BotAction = { kind: 'speak' | 'vote' | 'decide'; bot: DemoBot; phaseId: string; roundId: string; key: string }

/** The bot's own live speaking turn, read from that bot's snapshot. */
export function botSpeakingTurn(bot: DemoBot, snapshot: Snapshot): Omit<BotAction, 'kind' | 'key'> | null {
    const game = snapshot?.game
    if (!snapshot || !game || snapshot.phase !== 'speaking' || !game.active_speaker_id || game.active_speaker_id !== snapshot.self_member_id) return null
    if (game.allowed_actions && !game.allowed_actions.includes('finish_speaking')) return null
    return { bot, phaseId: game.phase_id, roundId: game.round_id }
}

/** The bot's own open individual decision step (not yet submitted), read from that bot's snapshot. */
export function botDecisionStep(bot: DemoBot, snapshot: Snapshot): Omit<BotAction, 'kind' | 'key'> | null {
    const game = snapshot?.game
    if (!snapshot || !game || snapshot.phase !== 'individual_decision' || game.individual_decisions?.self) return null
    if (game.allowed_actions && !game.allowed_actions.includes('submit_decision')) return null
    return { bot, phaseId: game.phase_id, roundId: game.round_id }
}

/**
 * Which bot acts now, given every seat's snapshot (Alex first) and the action keys already taken.
 * A bot speaks on its own turn. Bots vote only after the CEO's ballot is in, Morgan before Sam,
 * and each bot votes at most once per voting phase (a later CEO vote change does not re vote).
 * In individual decision games each bot writes its own decision once per phase, independent of Alex.
 */
export function nextBotAction(snapshots: readonly Snapshot[], handled: ReadonlySet<string>): BotAction | null {
    for (const bot of DEMO_BOTS) {
        const turn = botSpeakingTurn(bot, snapshots[bot.index])
        const key = turn && `speak:${turn.phaseId}:${bot.seat}`
        if (turn && key && !handled.has(key)) return { kind: 'speak', key, ...turn }
    }
    for (const bot of DEMO_BOTS) {
        const step = botDecisionStep(bot, snapshots[bot.index])
        const key = step && `decide:${step.phaseId}:${bot.seat}`
        if (step && key && !handled.has(key)) return { kind: 'decide', key, ...step }
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
export type BotActivity = 'clip' | 'fallback' | 'committing' | 'deciding' | 'writing'

/** A bot's fallback private answer for a Round 2 or Round 3 question. */
export function botPrivateAnswer(bot: DemoBot, round: 2 | 3): string {
    return round === 3 ? bot.privateAnswers.assessment : bot.privateAnswers.coaching
}

/**
 * Status shown in the solo Board strip for one bot. `privateStatus` is the bot's own private session progress
 * ("coaching 2/3", "response card", "assessment 1/3", "complete") as read by the parent page.
 */
export function botStatusText(bot: DemoBot, snapshots: readonly Snapshot[], activity: BotActivity | null | undefined, privateStatus?: string | null): string {
    if (activity === 'clip') return 'speaking (playing saved clip)…'
    if (activity === 'fallback') return 'speaking…'
    if (activity === 'committing') return 'passing the turn…'
    if (activity === 'deciding') return 'deciding…'
    if (activity === 'writing') return 'writing…'
    const own = snapshots[bot.index]
    if (!own) return 'connecting…'
    const self = own.members.find((member) => member.member_id === own.self_member_id)
    if (self && !self.connected) return 'reconnecting…'
    const game = own.game
    if (!game) return 'waiting'
    if (own.phase === 'speaking' && game.active_speaker_id === own.self_member_id) return 'speaking…'
    const turn = (game.turns ?? []).findLast((item) => item.member_id === own.self_member_id && item.round_id === game.round_id)
    if (['speaking', 'discussion'].includes(own.phase) && turn) return turn.reason === 'finished' ? 'spoke' : turn.reason === 'disconnected' ? 'skipped (disconnected)' : 'turn ended'
    if (own.phase === 'individual_decision') return game.individual_decisions?.self ? 'submitted' : 'writing…'
    if (own.phase === 'private_session') return privateStatus || progressStatus(game.private_progress?.find((item) => item.member_id === own.self_member_id)?.stage)
    if (own.phase === 'ended' && game.private_rounds) return game.private_progress?.find((item) => item.member_id === own.self_member_id)?.stage === 'complete' || privateStatus === 'complete' ? 'complete' : 'ended early'
    if (own.phase === 'ended' && game.decision_mode === 'individual') return game.individual_decisions?.self ? 'submitted' : 'decisions closed'
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
    const individual = game.decision_mode === 'individual'
    switch (ceo.phase) {
        case 'briefing':
        case 'reading': return stage('Opening briefing: listen in your view, or use Skip phase')
        case 'speaking': {
            if (game.active_speaker_id === ceo.self_member_id) return stage('Your turn: speak or play your clip, then finish your turn')
            const speaker = ceo.members.find((member) => member.member_id === game.active_speaker_id)
            return stage(speaker ? `${speaker.display_name} has the floor` : 'Speaking turns')
        }
        case 'discussion': return stage(game.discussion_mode === 'experts'
            ? `Expert panel: ${individual ? 'decisions open' : 'voting opens'} when the experts finish`
            : `Open discussion before ${individual ? 'your decision' : 'the vote'}`)
        case 'individual_decision': {
            if (!game.individual_decisions?.self) return stage('Write your decision', { action: null })
            const botsDone = DEMO_BOTS.every((bot) => snapshots[bot.index]?.game?.individual_decisions?.self)
            return stage(botsDone ? 'Decision submitted · closing decisions…' : 'Decision submitted · the board is writing…')
        }
        case 'voting': {
            if (game.self_vote == null) return stage('Your decision first: vote in your view (you may add your own option)')
            const botsVoted = DEMO_BOTS.every((bot) => snapshots[bot.index]?.game?.self_vote != null)
            if (!botsVoted) return stage('The board is deciding…')
            // Individual decision games never offer the record call to action.
            const canRecord = !individual && (game.allowed_actions?.includes('skip_phase') ?? false)
            return stage(canRecord ? 'The board has voted: record the final decision' : 'The board has voted', { action: canRecord ? 'record' : null })
        }
        case 'private_session': return stage('Your private session with the crisis coach')
        case 'tie_break': return stage('Tie — choose the final decision in your view')
        case 'resolving': return stage('Evaluating the custom decision…')
        case 'resolution_failed': return stage('The custom decision could not be evaluated: retry in your view')
        case 'decision': return stage('Recording the decision…')
        case 'result': return stage('Decision recorded', { decision: label })
        case 'ended': {
            if (game.private_rounds) return stage('Game over · see your response card and score in your view', { over: true })
            if (individual) return stage('Game over · decisions recorded', { over: true })
            const final = label ?? game.last_result?.selected_option_label ?? null
            return stage(game.last_result ? 'Decision recorded · game over' : 'Game over', { decision: final, over: true })
        }
    }
}

// Three window demo: Alex hosts in this window; Morgan and Sam open their own join links (other windows or devices).
export type JoinSeat = 'morgan' | 'sam'
export const JOIN_SEATS: readonly { seat: JoinSeat; name: string; role: string }[] = [
    { seat: 'morgan', name: 'Morgan', role: 'IT recovery lead' },
    { seat: 'sam', name: 'Sam', role: 'Communications lead' },
]

/** A join link for one seat: `<origin><path>#/demo/join?code=ABC123&seat=morgan[&view=3d]`. */
export function joinLink(origin: string, pathname: string, roomCode: string, seat: JoinSeat, view: DemoView): string {
    return `${origin}${pathname}#/demo/join?code=${roomCode}&seat=${seat}${view === '3d' ? '&view=3d' : ''}`
}

export type JoinRequest = { code: string; seat: JoinSeat; name: string; role: string; view: DemoView | null }

/** Reads a join link's query (the part after `#/demo/join?`); null when the code or seat is not valid. */
export function readJoinRequest(query: string): JoinRequest | null {
    const params = new URLSearchParams(query)
    const code = (params.get('code') ?? '').trim().toUpperCase()
    const seat = JOIN_SEATS.find((option) => option.seat === params.get('seat'))
    if (!/^[A-Z0-9]{6}$/.test(code) || !seat) return null
    const view = params.get('view')
    return { code, seat: seat.seat, name: seat.name, role: seat.role, view: view === '3d' || view === 'call' ? view : null }
}

/** Alex is the host; Morgan and Sam are matched by display name (case and spacing ignored). */
export function windowSeats(room: Pick<RoomSnapshot, 'host_member_id' | 'members'>): { alex: string | null; morgan: string | null; sam: string | null } {
    const named = (name: string) => room.members.find((member) => member.member_id !== room.host_member_id && member.display_name.trim().toLowerCase() === name.toLowerCase())?.member_id ?? null
    return { alex: room.host_member_id ?? null, morgan: named('Morgan'), sam: named('Sam') }
}

/** Links built on a loopback address only open on this computer. */
export function isLoopbackOrigin(origin: string): boolean {
    try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname) } catch { return false }
}
