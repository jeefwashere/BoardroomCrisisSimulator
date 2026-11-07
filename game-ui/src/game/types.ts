/**
 * Client view of a room. Fields up to `members` follow docs/room-api.md and docs/start-api.md.
 * The gameplay fields inside `game` (node, speaker, ballots, tie, results) are a proposal for
 * I01: the backend does not serve them yet, so only the mock client fills them in.
 * Times are epoch milliseconds; an HTTP adapter converts server ISO strings.
 */
export type Phase = 'lobby' | 'briefing' | 'reading' | 'discussion' | 'voting' | 'tie' | 'result' | 'debrief'

export type RoleId = 'ceo' | 'security' | 'technology' | 'finance' | 'operations' | 'communications_privacy'

export interface Member {
  member_id: string
  display_name: string
  is_host: boolean
  connected: boolean
  role_id: RoleId | null
  eligible_from_round: number | null
  eligible_current_round: boolean
}

export interface OptionView {
  id: string
  label: string
}

export interface NodeView {
  id: string
  title: string
  story_time: string
  inject: string
  study_questions: string[]
  options: OptionView[]
}

export interface Speaker {
  member_id: string
  started_at: number
  ends_at: number
}

export interface RoundResult {
  round_number: number
  node_title: string
  option_id: string | null
  option_label: string | null
  tally: Record<string, number>
  decided_by: 'vote' | 'ceo_tie' | 'no_decision'
  summary: string
  metric_deltas: Record<string, number>
  ending_label: string | null
}

export interface GameView {
  phase_id: string
  round_number: number
  round_count: number
  scenario: { scenario_id: string; version: number; title: string }
  timing_profile: string
  phase_started_at: number
  deadline_at: number | null
  public_documents: { id: string; text: string }[]
  metrics: Record<string, number>
  node: NodeView | null
  speaker: Speaker | null
  speaker_order: string[]
  eligible_member_ids: string[]
  ballots_cast: number
  my_ballot: string | null
  tie: { option_ids: string[]; ceo_member_id: string } | null
  last_result: RoundResult | null
  history: RoundResult[]
  ending_label: string | null
  debrief_questions: string[]
}

export interface RoomSnapshot {
  room_id: string
  room_code: string
  room_version: number
  phase: Phase
  capacity: number
  host_member_id: string
  self_member_id: string
  members: Member[]
  game: GameView | null
}

export interface GameClient {
  readonly kind: 'mock' | 'http'
  subscribe(listener: (snapshot: RoomSnapshot) => void): () => void
  castVote(optionId: string): Promise<void>
  ceoChoose(optionId: string): Promise<void>
  finishTurn(): Promise<void>
  /** Mock only: jump to the end of the current phase. */
  skipPhase?(): void
  /** Mock only: make the current vote a tie between the first two options. */
  forceTie?(): void
  dispose(): void
}

export const ROLE_NAMES: Record<RoleId, string> = {
  ceo: 'CEO',
  security: 'Security lead',
  technology: 'Technology lead',
  finance: 'Finance lead',
  operations: 'Operations lead',
  communications_privacy: 'Comms & privacy lead',
}

/** Role colours; keep in step with the .role-* rules in styles.css. */
export const ROLE_COLORS: Record<string, string> = {
  ceo: '#ae5238',
  security: '#2f5d8a',
  technology: '#5b4b8a',
  finance: '#3f7d5c',
  operations: '#a87522',
  communications_privacy: '#8a4b6b',
  none: '#687065',
}

/** Short labels for the 3D name tags. */
export const ROLE_SHORT: Record<RoleId, string> = {
  ceo: 'CEO',
  security: 'Security',
  technology: 'Technology',
  finance: 'Finance',
  operations: 'Operations',
  communications_privacy: 'Comms & privacy',
}

export const METRIC_NAMES: Record<string, string> = {
  service_continuity: 'Service continuity',
  data_protection: 'Data protection',
  public_trust: 'Public trust',
}

export function humanize(label: string | null): string {
  if (!label) return ''
  const text = label.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
