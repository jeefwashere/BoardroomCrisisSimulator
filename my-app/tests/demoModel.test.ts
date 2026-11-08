import assert from 'node:assert/strict'
import test from 'node:test'
import { DEMO_BOTS, backsCeoByChance, botStatusLine, botStatusText, botVoteChoice, demoRoles, demoRoomCode, followTarget, keywordScore, nextBotAction, pickDemoScenario, readStoredDemo, seatStatus, seededHash, soloStage, turnBudgetMs } from '../src/features/demo/demoModel.ts'
import type { RoomGame, RoomSnapshot, Scenario } from '../src/services/rooms.ts'

const scenario: Scenario = {
    scenario_id: 'fixture', version: 3, title: 'Fixture', content_sha256: 'digest',
    roles: [{ role_id: 'ceo', name: 'CEO' }, { role_id: 'security', name: 'Security' }, { role_id: 'finance', name: 'Finance' }],
    timings: [{ profile_id: 'standard_18', briefing_seconds: 180 }],
}
const roles: Record<string, string> = { a: 'ceo', b: 'security', c: 'finance' }

function room(self: string, phase: RoomSnapshot['phase'], game: Partial<RoomGame> = {}): RoomSnapshot {
    const base = {
        room_id: 'room', room_code: 'ABC123', room_version: 3, capacity: 30 as const, presence_window_seconds: 30 as const,
        host_member_id: 'a', self_member_id: self,
        members: ['a', 'b', 'c'].map((id) => ({ member_id: id, display_name: id, is_host: id === 'a', connected: true, role_id: phase === 'lobby' ? null : roles[id], eligible_from_round: 1, eligible_current_round: true })),
    }
    if (phase === 'lobby') return { ...base, phase, game: null }
    return { ...base, phase, game: {
        phase_id: 'p1', round_id: 'r1', round_number: 1, started_at: '', scenario, timing_profile: 'standard_18', briefing_seconds: 180, result_seconds: 30,
        initial_node_id: 'n', facts: {}, public_documents: [], eligible_member_ids: ['a', 'b', 'c'], ending_label: null, ...game,
    } }
}

test('demo room codes are six valid characters and stored demos are validated', () => {
    assert.match(demoRoomCode(), /^[A-Z0-9]{6}$/)
    assert.equal(demoRoomCode(() => new Uint8Array([0, 1, 2, 3, 4, 5])), 'ABCDEF')
    const id = '9d716cd1-a7c8-4e73-a8ac-a05634972559'
    // Demos stored before the mode choice restore as three seats; the mode round trips otherwise.
    assert.deepEqual(readStoredDemo(JSON.stringify({ room_id: id, room_code: 'K7MPQ2' })), { room_id: id, room_code: 'K7MPQ2', mode: 'seats' })
    assert.deepEqual(readStoredDemo(JSON.stringify({ room_id: id, room_code: 'K7MPQ2', mode: 'solo' })), { room_id: id, room_code: 'K7MPQ2', mode: 'solo' })
    assert.deepEqual(readStoredDemo(JSON.stringify({ room_id: id, room_code: 'K7MPQ2', mode: 'bogus' })), { room_id: id, room_code: 'K7MPQ2', mode: 'seats' })
    for (const raw of [null, '', '{', '[]', JSON.stringify({ room_id: 'x', room_code: 'K7MPQ2' }), JSON.stringify({ room_id: id, room_code: 'bad' })]) assert.equal(readStoredDemo(raw), null)
})

test('the demo prefers the T01 Cedar Bridge scenario, else the first listed', () => {
    const t01 = { ...scenario, scenario_id: 'cedar_bridge_t01' }
    assert.equal(pickDemoScenario([scenario, t01]), t01)
    assert.equal(pickDemoScenario([scenario]), scenario)
    assert.equal(pickDemoScenario([]), undefined)
})

test('Alex becomes CEO, Morgan takes recovery or IT and Sam communications', () => {
    const maplecart = { ...scenario, roles: [{ role_id: 'ceo', name: 'CEO' }, { role_id: 'security', name: 'Security lead' }, { role_id: 'technology', name: 'Technology lead' }, { role_id: 'finance', name: 'Finance lead' }, { role_id: 'communications_privacy', name: 'Communications and privacy lead' }] }
    assert.deepEqual(demoRoles(room('a', 'lobby'), ['a', 'b', 'c'], maplecart), { a: 'ceo', b: 'technology', c: 'communications_privacy' })
    const t01 = { ...scenario, roles: [{ role_id: 'ceo', name: 'Interim lead' }, { role_id: 'comms', name: 'Communications officer' }, { role_id: 'it_recovery', name: 'IT recovery' }] }
    assert.deepEqual(demoRoles(room('a', 'lobby'), ['a', 'b', 'c'], t01), { a: 'ceo', b: 'it_recovery', c: 'comms' })
    // Without matching roles, Morgan and Sam take distinct roles in scenario order.
    assert.deepEqual(demoRoles(room('a', 'lobby'), ['a', 'b', 'c'], scenario), { a: 'ceo', b: 'security', c: 'finance' })
    assert.throws(() => demoRoles(room('a', 'lobby'), ['a', 'b', 'c'], { ...scenario, roles: [{ role_id: 'security', name: 'Security' }] }), /CEO/)
})

test('seat indicators report speaking, deciding, voted and CEO tie states', () => {
    assert.deepEqual(seatStatus(null), { phase: null, roleId: null, speaking: false, decide: false, voted: false, ceoTie: false })
    assert.equal(seatStatus(room('b', 'speaking', { active_speaker_id: 'b' })).speaking, true)
    assert.equal(seatStatus(room('a', 'speaking', { active_speaker_id: 'b' })).speaking, false)
    assert.equal(seatStatus(room('a', 'voting', { allowed_actions: ['vote'], self_vote: null })).decide, true)
    assert.deepEqual([seatStatus(room('a', 'voting', { allowed_actions: ['vote'], self_vote: 'opt' }))].map((status) => [status.decide, status.voted]), [[false, true]])
    assert.equal(seatStatus(room('a', 'voting', { allowed_actions: [], self_vote: null })).decide, false)
    assert.equal(seatStatus(room('a', 'tie_break')).ceoTie, true)
    assert.equal(seatStatus(room('b', 'tie_break')).ceoTie, false)
})

test('auto follow picks the speaker, the next voter in seat order, then the CEO', () => {
    const seats = ['a', 'b', 'c']
    assert.equal(followTarget(seats.map((id) => room(id, 'speaking', { active_speaker_id: 'c' }))), 2)
    const votes: Record<string, string | null> = { a: 'x', b: null, c: null }
    assert.equal(followTarget(seats.map((id) => room(id, 'voting', { allowed_actions: ['vote'], self_vote: votes[id] }))), 1)
    assert.equal(followTarget(seats.map((id) => room(id, 'voting', { allowed_actions: ['vote'], self_vote: 'x' }))), 0)
    assert.equal(followTarget(seats.map((id) => room(id, 'tie_break'))), 0)
    assert.equal(followTarget(seats.map((id) => room(id, 'discussion'))), null)
    assert.equal(followTarget([null, null, null]), null)
})

// The authored T01 Cedar Bridge ballot.
const T01_OPTIONS = [
    { option_id: 'controlled_continuity', label: 'Controlled continuity', kind: 'prepared', description: 'Appoint an interim incident coordinator, authorize the approved paper appointment process, ask IT to verify backup usability, recovery dependencies and a restoration estimate before any restoration promise, and issue a factual update that separates confirmed facts from unknowns and states the next update time.' },
    { option_id: 'technical_first', label: 'Technical checks first', kind: 'prepared', description: 'Appoint an interim incident coordinator, keep appointments paused until IT verifies recovery, and issue a factual update that separates confirmed facts from unknowns and states the next update time.' },
    { option_id: 'wait_for_director', label: 'Wait for the director', kind: 'prepared', description: 'Keep appointments paused and defer the interim coordinator appointment and paper appointment process while awaiting the director.' },
]
const [MORGAN, SAM] = DEMO_BOTS

/** A room id whose seeded chance gives the wanted "back the CEO" result for both bots. */
function roomWhere(morganBacks: boolean, samBacks: boolean): string {
    for (let index = 0; index < 1000; index++) {
        const id = `room-${index}`
        if (backsCeoByChance(id, 'morgan') === morganBacks && backsCeoByChance(id, 'sam') === samBacks) return id
    }
    throw new Error('No matching room id')
}

test('bot keyword scores favour label hits and the seeded chance is stable', () => {
    assert.ok(keywordScore(T01_OPTIONS[1], MORGAN.keywords) > keywordScore(T01_OPTIONS[0], MORGAN.keywords))
    assert.ok(keywordScore(T01_OPTIONS[0], SAM.keywords) > keywordScore(T01_OPTIONS[1], SAM.keywords))
    assert.equal(keywordScore(T01_OPTIONS[2], MORGAN.keywords), 0)
    // "IT" only matches the capitalised acronym, never the pronoun.
    assert.equal(keywordScore({ option_id: 'x', label: 'Let it be' }, MORGAN.keywords), 0)
    assert.equal(seededHash('abc'), seededHash('abc'))
    assert.notEqual(seededHash('abc'), seededHash('abd'))
    assert.equal(backsCeoByChance('room-1', 'morgan'), backsCeoByChance('room-1', 'morgan'))
    // Roughly one in three across many rooms.
    const backed = Array.from({ length: 900 }, (_, index) => backsCeoByChance(`room-${index}`, 'sam')).filter(Boolean).length
    assert.ok(backed > 220 && backed < 380, `backed ${backed} of 900`)
})

test('Morgan prefers technical checks, Sam continuity, so "Wait for the director" ties three ways', () => {
    const roomId = roomWhere(false, false)
    const vote = (bot: typeof MORGAN) => botVoteChoice({ bot, options: T01_OPTIONS, ceoVote: 'wait_for_director', ceoMemberId: 'a', roomId })
    assert.equal(vote(MORGAN), 'technical_first')
    assert.equal(vote(SAM), 'controlled_continuity')
})

test('the seeded chance and missing keyword matches back the CEO, including the CEO\'s custom option', () => {
    const backing = roomWhere(true, false)
    assert.equal(botVoteChoice({ bot: MORGAN, options: T01_OPTIONS, ceoVote: 'wait_for_director', ceoMemberId: 'a', roomId: backing }), 'wait_for_director')
    assert.equal(botVoteChoice({ bot: SAM, options: T01_OPTIONS, ceoVote: 'wait_for_director', ceoMemberId: 'a', roomId: backing }), 'controlled_continuity')
    const plain = [{ option_id: 'one', label: 'Option one' }, { option_id: 'two', label: 'Option two' }]
    const neutral = roomWhere(false, false)
    assert.equal(botVoteChoice({ bot: MORGAN, options: plain, ceoVote: 'two', ceoMemberId: 'a', roomId: neutral }), 'two')
    // Alex's custom option counts as the CEO's choice; keyword matching ignores custom options.
    const custom = { option_id: 'custom_1', label: 'Publish a public update and verify backups', kind: 'custom', member_id: 'a' }
    assert.equal(botVoteChoice({ bot: SAM, options: [...plain, custom], ceoVote: 'custom_1', ceoMemberId: 'a', roomId: neutral }), 'custom_1')
    assert.equal(botVoteChoice({ bot: SAM, options: [...plain, custom], ceoVote: null, ceoMemberId: 'a', roomId: neutral }), 'custom_1')
    // A custom option by someone else is never backed; with nothing else, the first authored option.
    assert.equal(botVoteChoice({ bot: SAM, options: [...plain, { ...custom, member_id: 'b' }], ceoVote: null, ceoMemberId: 'a', roomId: neutral }), 'one')
    assert.equal(botVoteChoice({ bot: SAM, options: [], ceoVote: null, ceoMemberId: 'a', roomId: neutral }), null)
})

const seats = ['a', 'b', 'c']
const views = (phase: RoomSnapshot['phase'], game: (id: string) => Partial<RoomGame>) => seats.map((id) => room(id, phase, game(id)))

test('a bot speaks on its own turn, once per phase', () => {
    const speaking = views('speaking', (id) => ({ phase_id: 'turn-2', active_speaker_id: 'b', allowed_actions: id === 'b' ? ['finish_speaking'] : [] }))
    const action = nextBotAction(speaking, new Set())
    assert.deepEqual(action && [action.kind, action.bot.seat, action.phaseId, action.roundId, action.key], ['speak', 'morgan', 'turn-2', 'r1', 'speak:turn-2:morgan'])
    assert.equal(nextBotAction(speaking, new Set(['speak:turn-2:morgan'])), null)
    // Alex's own turn is never automated.
    assert.equal(nextBotAction(views('speaking', () => ({ active_speaker_id: 'a', allowed_actions: ['finish_speaking'] })), new Set()), null)
    const samTurn = views('speaking', (id) => ({ phase_id: 'turn-3', active_speaker_id: 'c', allowed_actions: id === 'c' ? ['finish_speaking'] : [] }))
    assert.equal(nextBotAction(samTurn, new Set())?.bot.seat, 'sam')
})

test('bots vote only after the CEO, Morgan before Sam, and never twice in a phase', () => {
    const ballots = (votes: Record<string, string | null>) => views('voting', (id) => ({ phase_id: 'vote-1', allowed_actions: ['vote'], self_vote: votes[id] }))
    assert.equal(nextBotAction(ballots({ a: null, b: null, c: null }), new Set()), null)
    assert.deepEqual([nextBotAction(ballots({ a: 'x', b: null, c: null }), new Set())].map((action) => action && [action.kind, action.bot.seat, action.key]), [['vote', 'morgan', 'vote:vote-1:morgan']])
    assert.equal(nextBotAction(ballots({ a: 'x', b: null, c: null }), new Set(['vote:vote-1:morgan']))?.bot.seat, 'sam')
    assert.equal(nextBotAction(ballots({ a: 'x', b: 'y', c: null }), new Set())?.bot.seat, 'sam')
    assert.equal(nextBotAction(ballots({ a: 'x', b: 'y', c: 'z' }), new Set()), null)
    // A changed CEO vote does not re run handled bots.
    assert.equal(nextBotAction(ballots({ a: 'changed', b: null, c: null }), new Set(['vote:vote-1:morgan', 'vote:vote-1:sam'])), null)
    assert.equal(nextBotAction(views('tie_break', () => ({ self_vote: 'x' })), new Set()), null)
})

test('the turn budget leaves margin before the deadline', () => {
    assert.equal(turnBudgetMs({ server_time: '2026-01-01T00:00:00Z', phase_deadline: '2026-01-01T00:00:30Z' }), 27000)
    assert.equal(turnBudgetMs({ server_time: '2026-01-01T00:00:00Z', phase_deadline: '2026-01-01T00:00:01Z' }), 1000)
    assert.equal(turnBudgetMs(null), 25000)
})

test('Board strip status reflects local activity first, then each bot\'s snapshot', () => {
    const speaking = views('speaking', () => ({ active_speaker_id: 'b' }))
    assert.equal(botStatusLine(MORGAN, speaking, 'clip'), 'Morgan · IT recovery lead — speaking (playing saved clip)…')
    assert.equal(botStatusText(MORGAN, speaking, null), 'speaking…')
    assert.equal(botStatusText(SAM, speaking, null), 'waiting')
    assert.equal(botStatusText(SAM, speaking, 'deciding'), 'deciding…')
    assert.equal(botStatusText(MORGAN, [null, null, null], null), 'connecting…')
    const spoke = views('speaking', () => ({ active_speaker_id: 'c', turns: [{ member_id: 'b', phase_id: 'x', round_id: 'r1', reason: 'finished', started_at: '', ended_at: '' }] }))
    assert.equal(botStatusText(MORGAN, spoke, null), 'spoke')
    const voting = views('voting', (id) => ({ self_vote: id === 'b' ? 'opt' : null, allowed_actions: ['vote'] }))
    assert.equal(botStatusText(MORGAN, voting, null), 'voted')
    assert.equal(botStatusText(SAM, voting, null), 'waiting for your vote')
    const offline = voting.map((view) => ({ ...view, members: view.members.map((member) => member.member_id === 'c' ? { ...member, connected: false } : member) }))
    assert.equal(botStatusText(SAM, offline, null), 'reconnecting…')
})

test('the solo bar asks the CEO to vote first, then to record the decision, then shows it', () => {
    const ballots = (votes: Record<string, string | null>, actions = ['vote', 'skip_phase']) => views('voting', (id) => ({ allowed_actions: id === 'a' ? actions : ['vote'], self_vote: votes[id] }))
    assert.match(soloStage(ballots({ a: null, b: null, c: null })).text, /^Your decision first/)
    assert.deepEqual(soloStage(ballots({ a: 'x', b: 'y', c: null })), { text: 'The board is deciding…', action: null, decision: null, over: false })
    assert.equal(soloStage(ballots({ a: 'x', b: 'y', c: 'z' })).action, 'record')
    assert.equal(soloStage(ballots({ a: 'x', b: 'y', c: 'z' }, ['vote'])).action, null)
    assert.equal(soloStage(views('tie_break', () => ({}))).text, 'Tie — choose the final decision in your view')
    const decision = { decision_id: 'd', round_number: 1, question: 'q', selected_option_label: 'Wait for the director', text: 't', selection_method: 'ceo', vote_counts: {} }
    assert.deepEqual(soloStage(views('ended', () => ({ last_result: decision, history: [decision] }))), { text: 'Decision recorded · game over', action: null, decision: 'Wait for the director', over: true })
    assert.deepEqual(soloStage(views('ended', () => ({ last_result: null }))), { text: 'Game over', action: null, decision: null, over: true })
    assert.match(soloStage(views('speaking', () => ({ active_speaker_id: 'a' }))).text, /^Your turn/)
    assert.equal(soloStage(views('speaking', () => ({ active_speaker_id: 'b' }))).text, 'b has the floor')
    assert.match(soloStage(views('discussion', () => ({ discussion_mode: 'experts' }))).text, /^Expert panel/)
    assert.equal(soloStage([null, null, null]).text, 'Connecting…')
})
