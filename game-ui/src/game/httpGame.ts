/**
 * Polls the FastAPI room snapshot (docs/room-api.md) every two seconds, one request at a time,
 * and maps it to the client view. The backend currently serves the lobby and the briefing only;
 * speaking, voting and outcomes are not implemented server side, so those actions reject.
 */
import type { GameClient, GameView, Member, RoomSnapshot } from './types'

interface ServerGame {
  phase_id: string
  round_number: number
  scenario: { scenario_id: string; version: number; title: string }
  timing_profile: string
  briefing_seconds: number
  started_at: string
  initial_metrics: Record<string, number>
  public_documents: { id: string; text: string }[]
  eligible_member_ids: string[]
}

interface ServerRoom {
  room_id: string
  room_code: string
  room_version: number
  phase: RoomSnapshot['phase']
  capacity: number
  host_member_id: string
  self_member_id: string
  members: Member[]
  game: ServerGame | null
}

export class HttpGameClient implements GameClient {
  readonly kind = 'http' as const
  private listeners = new Set<(s: RoomSnapshot) => void>()
  private latest: RoomSnapshot | null = null
  private stopped = false
  private api: string
  private roomId: string

  constructor(api: string, roomId: string) {
    this.api = api
    this.roomId = roomId
    void this.loop()
  }

  subscribe(listener: (s: RoomSnapshot) => void) {
    this.listeners.add(listener)
    if (this.latest) listener(this.latest)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    this.stopped = true
    this.listeners.clear()
  }

  async castVote() {
    throw new Error('Voting is not available from the backend yet (TODO B06).')
  }

  async ceoChoose() {
    throw new Error('CEO tie decisions are not available from the backend yet (TODO B07).')
  }

  async finishTurn() {
    throw new Error('Speaking turns are not available from the backend yet (TODO B08).')
  }

  private async loop() {
    await fetch(`${this.api}/api/session`, { credentials: 'include' })
    while (!this.stopped) {
      try {
        const response = await fetch(`${this.api}/api/rooms/${this.roomId}`, { credentials: 'include' })
        if (response.ok) this.accept(map((await response.json()) as ServerRoom))
      } catch {
        // Keep polling; the next cycle retries.
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  private accept(snapshot: RoomSnapshot) {
    // Discard older versions; equal versions still carry fresh presence.
    if (this.latest && snapshot.room_version < this.latest.room_version) return
    this.latest = snapshot
    this.listeners.forEach((listener) => listener(snapshot))
  }
}

function map(room: ServerRoom): RoomSnapshot {
  let game: GameView | null = null
  if (room.game) {
    const started = Date.parse(room.game.started_at)
    game = {
      phase_id: room.game.phase_id,
      round_number: room.game.round_number,
      round_count: 3,
      scenario: room.game.scenario,
      timing_profile: room.game.timing_profile,
      phase_started_at: started,
      deadline_at: started + room.game.briefing_seconds * 1000,
      public_documents: room.game.public_documents,
      metrics: room.game.initial_metrics,
      node: null,
      speaker: null,
      speaker_order: [],
      eligible_member_ids: room.game.eligible_member_ids,
      ballots_cast: 0,
      my_ballot: null,
      tie: null,
      last_result: null,
      history: [],
      ending_label: null,
      debrief_questions: [],
    }
  }
  return { ...room, game }
}
