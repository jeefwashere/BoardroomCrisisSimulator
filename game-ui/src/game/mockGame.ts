/**
 * Local, single-browser simulation of one game of the MapleCart scenario. It exists so the
 * in-game screens and the 3D room can be built before the backend serves gameplay.
 * It reads the authored scenario directly (including outcomes, which a real client never
 * receives) and follows its timing profile, vote policy and outcomes.
 */
import scenario from '@scenario/scenario.json'
import briefing from '@scenario/briefing.md?raw'
import evidence from '@scenario/initial-evidence.md?raw'
import operations from '@scenario/operations.md?raw'
import type { GameClient, Member, Phase, RoleId, RoomSnapshot, RoundResult } from './types'

type ScenarioNode = (typeof scenario.nodes)[number]
type Outcome = ScenarioNode['outcomes'][number] & { ending_label?: string }

const BOT_NAMES = ['Ricardo', 'Jeff', 'Priya', 'Sam', 'Mei', 'Omar', 'Lena', 'Theo', 'Ana', 'Kofi', 'Ines']
const PERSPECTIVES: RoleId[] = ['security', 'technology', 'finance', 'operations', 'communications_privacy']

export interface MockOptions {
  players: number
  speed: number
  selfName: string
  selfIsCeo: boolean
  profile: 'standard_18' | 'fast_15'
}

export class MockGameClient implements GameClient {
  readonly kind = 'mock' as const
  private listeners = new Set<(s: RoomSnapshot) => void>()
  private timer: number
  private members: Member[]
  private selfId: string
  private ceoId: string
  private phase: Phase = 'briefing'
  private phaseStart = Date.now()
  private deadline: number | null = null
  private round = 0
  private node: ScenarioNode | null = null
  private metrics: Record<string, number> = { ...scenario.initial_metrics }
  private speakerOrder: string[] = []
  private speakerIndex = -1
  private speakerStart = 0
  private speakerEnd = 0
  private ballots = new Map<string, string>()
  private botVoteAt = new Map<string, { at: number; option: string | null }>()
  private tieIds: string[] = []
  private ceoBotChoiceAt = 0
  private lastResult: RoundResult | null = null
  private lastOutcome: Outcome | null = null
  private history: RoundResult[] = []
  private ending: string | null = null
  private version = 1
  private timing: (typeof scenario.timing_profiles)['standard_18']
  private options: MockOptions

  constructor(options: MockOptions) {
    this.options = options
    this.timing = scenario.timing_profiles[options.profile]
    const count = Math.max(3, Math.min(30, options.players))
    this.members = Array.from({ length: count }, (_, i) => {
      const role: RoleId = i === 0 ? (options.selfIsCeo ? 'ceo' : 'security') : PERSPECTIVES[(i - 1) % PERSPECTIVES.length]
      return {
        member_id: `m${i + 1}`,
        display_name: i === 0 ? options.selfName : BOT_NAMES[(i - 1) % BOT_NAMES.length],
        is_host: i === 1,
        connected: true,
        role_id: role,
        eligible_from_round: 1,
        eligible_current_round: true,
      }
    })
    if (!options.selfIsCeo) this.members[1].role_id = 'ceo'
    this.selfId = this.members[0].member_id
    this.ceoId = this.members.find((m) => m.role_id === 'ceo')!.member_id
    this.enter('briefing', this.timing.briefing_seconds)
    this.timer = window.setInterval(() => this.tick(), 200)
  }

  subscribe(listener: (s: RoomSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  dispose() {
    window.clearInterval(this.timer)
    this.listeners.clear()
  }

  async castVote(optionId: string) {
    if (this.phase !== 'voting') throw new Error('Voting is closed')
    if (!this.node?.options.some((o) => o.id === optionId)) throw new Error('Unknown option')
    this.ballots.set(this.selfId, optionId) // vote_policy.allow_replacement
    this.emit()
  }

  async ceoChoose(optionId: string) {
    if (this.phase !== 'tie' || this.selfId !== this.ceoId) throw new Error('Only the CEO can break this tie')
    if (!this.tieIds.includes(optionId)) throw new Error('Choose one of the tied options')
    this.resolve(optionId, 'ceo_tie')
  }

  async finishTurn() {
    if (this.phase === 'discussion' && this.speakerOrder[this.speakerIndex] === this.selfId) this.nextSpeaker()
  }

  skipPhase() {
    if (this.phase === 'discussion' && this.speakerIndex >= 0 && this.speakerIndex < this.speakerOrder.length) {
      this.speakerIndex = this.speakerOrder.length
      this.emit()
      return
    }
    if (this.deadline) this.deadline = Date.now()
    this.tick()
  }

  forceTie() {
    if (this.phase !== 'voting' || !this.node) return
    const [a, b] = this.node.options
    this.ballots.clear()
    this.botVoteAt.clear()
    this.members.forEach((m, i) => this.ballots.set(m.member_id, i % 2 ? b.id : a.id))
    if (this.members.length % 2) this.ballots.delete(this.members[this.members.length - 1].member_id)
    this.deadline = Date.now()
    this.tick()
  }

  // ---- engine ----

  private scaled(seconds: number) {
    return (seconds * 1000) / this.options.speed
  }

  private enter(phase: Phase, seconds: number | null) {
    this.phase = phase
    this.phaseStart = Date.now()
    this.deadline = seconds === null ? null : this.phaseStart + this.scaled(seconds)
    this.version += 1
    this.emit()
  }

  private startRound(node: ScenarioNode) {
    this.round += 1
    this.node = node
    this.ballots.clear()
    this.botVoteAt.clear()
    this.tieIds = []
    this.enter('reading', this.timing.reading_seconds_per_round)
  }

  private startDiscussion() {
    this.speakerOrder = this.members.filter((m) => m.eligible_current_round).map((m) => m.member_id)
    this.speakerIndex = -1
    this.enter('discussion', this.timing.discussion_seconds_per_round)
    this.nextSpeaker()
  }

  private allocation() {
    // speaker_allocation: min(speaker_max_seconds, floor(discussion / eligible players))
    return Math.min(this.timing.speaker_max_seconds, Math.floor(this.timing.discussion_seconds_per_round / this.speakerOrder.length))
  }

  private nextSpeaker() {
    this.speakerIndex += 1
    this.speakerStart = Date.now()
    this.speakerEnd = this.speakerStart + this.scaled(this.allocation())
    this.version += 1
    this.emit()
  }

  private startVoting() {
    const node = this.node!
    const window = this.scaled(scenario.vote_policy.duration_seconds)
    for (const m of this.members) {
      if (m.member_id === this.selfId) continue
      const roll = Math.random()
      const others = node.options.filter((o) => o.id !== node.preferred_option_id)
      const option = roll < 0.08 ? null : roll < 0.55 ? node.preferred_option_id : others[Math.floor(Math.random() * others.length)].id
      this.botVoteAt.set(m.member_id, { at: Date.now() + window * (0.1 + Math.random() * 0.75), option })
    }
    this.enter('voting', scenario.vote_policy.duration_seconds)
  }

  private closeVoting() {
    const tally = this.tally()
    const counts = Object.values(tally)
    const top = Math.max(0, ...counts)
    if (top === 0) return this.resolve(null, 'no_decision')
    const leaders = Object.keys(tally).filter((id) => tally[id] === top)
    if (leaders.length === 1) return this.resolve(leaders[0], 'vote')
    this.tieIds = leaders
    this.ceoBotChoiceAt = Date.now() + this.scaled(4 + Math.random() * 6)
    this.enter('tie', scenario.vote_policy.ceo_timeout_seconds)
  }

  private tally() {
    const tally: Record<string, number> = Object.fromEntries(this.node!.options.map((o) => [o.id, 0]))
    for (const [member, option] of this.ballots) {
      if (this.members.find((m) => m.member_id === member)?.eligible_current_round) tally[option] += 1
    }
    return tally
  }

  private resolve(optionId: string | null, decidedBy: RoundResult['decided_by']) {
    const node = this.node!
    const option = node.options.find((o) => o.id === optionId) ?? null
    const outcomeId = option ? option.outcome_id : node.no_decision_outcome_id
    const outcome = node.outcomes.find((o) => o.id === outcomeId) as Outcome
    for (const [metric, delta] of Object.entries(outcome.metric_deltas)) {
      const bounds = scenario.metric_bounds[metric as keyof typeof scenario.metric_bounds]
      this.metrics[metric] = Math.max(bounds.minimum, Math.min(bounds.maximum, this.metrics[metric] + delta))
    }
    this.lastResult = {
      round_number: this.round,
      node_title: node.title,
      option_id: option?.id ?? null,
      option_label: option?.label ?? null,
      tally: this.tally(),
      decided_by: option ? decidedBy : 'no_decision',
      summary: outcome.summary,
      metric_deltas: outcome.metric_deltas,
      ending_label: outcome.ending_label ?? null,
    }
    this.lastOutcome = outcome
    this.history.push(this.lastResult)
    if (outcome.terminal) this.ending = outcome.ending_label ?? null
    this.enter('result', this.timing.result_seconds_per_round)
  }

  private tick() {
    const now = Date.now()
    if (this.phase === 'voting') {
      for (const [member, plan] of this.botVoteAt) {
        if (now >= plan.at) {
          if (plan.option) this.ballots.set(member, plan.option)
          this.botVoteAt.delete(member)
          this.emit()
        }
      }
    }
    if (this.phase === 'tie' && this.ceoId !== this.selfId && now >= this.ceoBotChoiceAt) {
      return this.resolve(this.tieIds[Math.floor(Math.random() * this.tieIds.length)], 'ceo_tie')
    }
    if (this.phase === 'discussion' && this.speakerIndex < this.speakerOrder.length && now >= this.speakerEnd) {
      this.nextSpeaker()
    }
    if (this.deadline === null || now < this.deadline) return
    switch (this.phase) {
      case 'briefing':
        return this.startRound(scenario.nodes.find((n) => n.id === scenario.initial_node_id)!)
      case 'reading':
        return this.startDiscussion()
      case 'discussion':
        return this.startVoting()
      case 'voting':
        return this.closeVoting()
      case 'tie':
        return this.resolve(null, 'no_decision') // CEO timeout takes the no decision outcome
      case 'result': {
        const last = this.lastOutcome
        if (!last || last.terminal || !last.next_node_id) return this.enter('debrief', this.timing.debrief_seconds)
        return this.startRound(scenario.nodes.find((n) => n.id === last.next_node_id)!)
      }
      case 'debrief':
        this.deadline = null
        return this.emit()
    }
  }

  private emit() {
    const snapshot = this.snapshot()
    this.listeners.forEach((listener) => listener(snapshot))
  }

  private snapshot(): RoomSnapshot {
    const node = this.node
    const inDiscussionTurns = this.phase === 'discussion' && this.speakerIndex >= 0 && this.speakerIndex < this.speakerOrder.length
    const showNode = node && this.phase !== 'briefing' && this.phase !== 'debrief'
    return {
      room_id: 'mock-room',
      room_code: 'K7MPQ2',
      room_version: this.version,
      phase: this.phase,
      capacity: scenario.room_constraints.capacity,
      host_member_id: this.members[1].member_id,
      self_member_id: this.selfId,
      members: this.members,
      game: {
        phase_id: `${this.phase}-${this.round}`,
        round_number: Math.max(1, this.round),
        round_count: this.timing.round_count,
        scenario: { scenario_id: scenario.scenario_id, version: scenario.version, title: scenario.title },
        timing_profile: this.options.profile,
        phase_started_at: this.phaseStart,
        deadline_at: this.deadline,
        public_documents: [
          { id: 'briefing', text: briefing },
          { id: 'initial_evidence', text: evidence },
          { id: 'operations', text: operations },
        ],
        metrics: { ...this.metrics },
        node: showNode
          ? {
              id: node.id,
              title: node.title,
              story_time: node.story_time,
              inject: node.inject,
              study_questions: node.study_questions,
              options: node.options.map((o) => ({ id: o.id, label: o.label })),
            }
          : null,
        speaker: inDiscussionTurns
          ? { member_id: this.speakerOrder[this.speakerIndex], started_at: this.speakerStart, ends_at: this.speakerEnd }
          : null,
        speaker_order: this.phase === 'discussion' ? this.speakerOrder : [],
        eligible_member_ids: this.members.filter((m) => m.eligible_current_round).map((m) => m.member_id),
        ballots_cast: this.ballots.size,
        my_ballot: this.ballots.get(this.selfId) ?? null,
        tie: this.phase === 'tie' ? { option_ids: this.tieIds, ceo_member_id: this.ceoId } : null,
        last_result: this.lastResult,
        history: this.history,
        ending_label: this.ending,
        debrief_questions: scenario.debrief_questions,
      },
    }
  }
}
