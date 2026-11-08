// Pure mapping from the room snapshot to what the 3D boardroom shows (docs/ui-integration-3d.md).
// The scene never shows spoken text: only who sits where, who is talking, and the phase and clock on the wall screen.

/** An AI voice on the call: the preparation agent, one of the experts, or the crisis coach. It speaks from the table hub. */
export type StageAgent = { kind: 'agent' | 'expert' | 'coach'; name: string; role: string; accent: string | null }

export type BoardMember = { id: string; name: string; role: string; color: string; connected: boolean }

export type BoardMood = 'sit' | 'talk'

export type BoardSeat = BoardMember & { isSelf: boolean; talking: boolean; mood: BoardMood }

export type BoardroomInput = {
    phase: string
    selfId: string
    /** Seat order: `[0]` Alex (leadership), `[1]` Morgan (recovery), `[2]` Sam (communications). */
    eligibleIds: readonly string[]
    activeSpeakerId: string | null
    speakerIndex: number | null
    speakerCount: number
    scenarioTitle: string
}

export type BoardroomView = {
    seats: BoardSeat[]
    /** The member the camera presents: whoever is talking, else the member holding the turn. Null while an agent talks. */
    focusId: string | null
    /** The agent speaking from the hub right now, or null. */
    agent: StageAgent | null
    /** An AI is part of this phase (briefing, expert panel, private coaching): the hub stays softly lit between lines. */
    agentPresent: boolean
    screen: { title: string; subtitle: string }
}

/** Seats round the table: a room holds 3 to 10 members and each gets a seat and a character. */
export const BOARD_SEATS = 10

const AGENT_PHASES = new Set(['briefing', 'reading', 'discussion', 'private_session'])

const PHASE_LABELS: Record<string, string> = {
    lobby: 'Waiting to start',
    briefing: 'Opening briefing',
    reading: 'Reading the situation',
    discussion: 'Expert panel',
    individual_decision: 'Individual decisions',
    private_session: 'Private sessions',
    ended: 'Game over',
}

/** Members in seat order: the electorate order first, then anyone else, at most `BOARD_SEATS`. */
export function boardMembers<T extends { id: string }>(members: readonly T[], eligibleIds: readonly string[]): T[] {
    const ordered = eligibleIds.map((id) => members.find((member) => member.id === id)).filter((member): member is T => Boolean(member))
    const rest = members.filter((member) => !eligibleIds.includes(member.id))
    return [...ordered, ...rest].slice(0, BOARD_SEATS)
}

export function screenSubtitle(input: Pick<BoardroomInput, 'phase' | 'speakerIndex' | 'speakerCount'>): string {
    if (input.phase === 'speaking') {
        return input.speakerIndex !== null && input.speakerCount > 0 ? `Turn ${input.speakerIndex + 1} of ${input.speakerCount}` : 'Speaking turns'
    }
    return PHASE_LABELS[input.phase] ?? input.phase.replaceAll('_', ' ')
}

export function boardroomView(input: BoardroomInput, members: readonly BoardMember[], talking: ReadonlySet<string>, agent: StageAgent | null): BoardroomView {
    const seated = boardMembers(members, input.eligibleIds)
    const seats = seated.map((member): BoardSeat => {
        const isSelf = member.id === input.selfId
        const isTalking = talking.has(member.id)
        // Everyone sits with hands on the table; only the person talking gestures. (The typing clip is not used.)
        return { ...member, isSelf, talking: isTalking, mood: isTalking ? 'talk' : 'sit' }
    })
    const talker = seats.find((seat) => seat.talking)
    const turnHolder = input.phase === 'speaking' && input.activeSpeakerId && seats.some((seat) => seat.id === input.activeSpeakerId) ? input.activeSpeakerId : null
    return {
        seats,
        focusId: agent ? null : talker?.id ?? turnHolder,
        agent,
        agentPresent: Boolean(agent) || AGENT_PHASES.has(input.phase),
        screen: { title: input.scenarioTitle, subtitle: screenSubtitle(input) },
    }
}

/** The stage choice for this tab, shared by the in game switch and the demo setup. */
export const STAGE_STORAGE_KEY = 'boardroom.stageView'

/** The stage to open: the tab's last choice, else `?view=` in the URL, else the call tiles. */
export function stagePreference(stored: string | null, search: string): '3d' | 'call' {
    if (stored === '3d' || stored === 'call') return stored
    return viewFromSearch(search) ?? 'call'
}

/** The 3D table seats ten (the room maximum). */
export function offersStageSwitch(memberCount: number): boolean {
    return memberCount > 0 && memberCount <= BOARD_SEATS
}

/** `?view=3d` (or `view=call`) chooses the stage for this frame. */
export function viewFromSearch(search: string): '3d' | 'call' | null {
    try {
        const value = new URLSearchParams(search).get('view')
        return value === '3d' || value === 'call' ? value : null
    } catch { return null }
}
