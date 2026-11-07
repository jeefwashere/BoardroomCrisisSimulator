import { useEffect, useMemo, useRef, useState } from 'react'
import { Boardroom, CHARACTER_IDS, type SceneState } from './scene/Boardroom'
import { Hud, memberMood } from './ui/Hud'
import { MockGameClient } from './game/mockGame'
import { HttpGameClient } from './game/httpGame'
import { ROLE_NAMES, type GameClient, type RoomSnapshot } from './game/types'

/**
 * Query parameters:
 *   ?room=<room_id>&api=http://localhost:8000  poll the real backend (briefing only today)
 *   ?players=10&speed=1&name=You&ceo=1&profile=standard_18  configure the mock game
 */
function createClient(): GameClient {
  const params = new URLSearchParams(window.location.search)
  const room = params.get('room')
  if (room) return new HttpGameClient(params.get('api') ?? 'http://localhost:8000', room)
  return new MockGameClient({
    players: Number(params.get('players') ?? CHARACTER_IDS.length),
    speed: Math.max(0.25, Number(params.get('speed') ?? 1)),
    selfName: params.get('name') ?? 'Arjun',
    selfIsCeo: params.get('ceo') !== '0',
    profile: params.get('profile') === 'fast_15' ? 'fast_15' : 'standard_18',
  })
}

export default function App() {
  const client = useMemo(createClient, [])
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [progress, setProgress] = useState({ loaded: 0, total: 1 })
  const stage = useRef<HTMLDivElement>(null)
  const boardroom = useRef<Boardroom | null>(null)

  useEffect(() => {
    const unsubscribe = client.subscribe(setRoom)
    return () => {
      unsubscribe()
      client.dispose()
    }
  }, [client])

  useEffect(() => {
    if (!stage.current) return
    const scene = new Boardroom(stage.current)
    scene.onProgress = (loaded, total) => setProgress({ loaded, total })
    boardroom.current = scene
    if (import.meta.env.DEV) (window as unknown as { __boardroom: Boardroom }).__boardroom = scene
    return () => {
      scene.dispose()
      boardroom.current = null
    }
  }, [])

  useEffect(() => {
    if (!room || !boardroom.current) return
    boardroom.current.update(toSceneState(room))
  }, [room])

  // Keep the table centred in the area the HUD panels leave clear (desktop layout).
  const phase = room?.phase
  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth
      if (!boardroom.current) return
      if (w < 1100) return boardroom.current.setInsets({ left: 0, right: 0, top: 0, bottom: 0 })
      const left = phase === 'briefing' ? Math.min(560, w * 0.44) + 28 : 368
      const bottom = phase === 'voting' || phase === 'tie' || phase === 'result' ? 250 : 170
      boardroom.current.setInsets({ left, right: 276, top: 104, bottom })
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [phase])

  const loading = progress.loaded < progress.total
  return (
    <div className="app">
      <div className="stage" ref={stage} />
      {loading && (
        <div className="loading">
          <span>Seating the board…</span>
          <span className="clock-track">
            <span style={{ width: `${(progress.loaded / progress.total) * 100}%` }} />
          </span>
        </div>
      )}
      {room?.game ? <Hud room={room} client={client} /> : <div className="waiting panel">Waiting for the host to start the game…</div>}
    </div>
  )
}

function toSceneState(room: RoomSnapshot): SceneState {
  const game = room.game
  const voted = new Set<string>()
  // Ballots stay private; only the caller's own vote is known to the client.
  if (game?.my_ballot) voted.add(room.self_member_id)
  const seats = room.members.slice(0, CHARACTER_IDS.length).map((m) => ({
    memberId: m.member_id,
    name: m.display_name,
    role: m.role_id ? ROLE_NAMES[m.role_id] : '',
    isSelf: m.member_id === room.self_member_id,
    connected: m.connected,
    voted: room.phase === 'voting' && voted.has(m.member_id),
    speaking: game?.speaker?.member_id === m.member_id,
    mood: memberMood(m, room),
  }))
  const subtitle: Record<string, string> = {
    briefing: 'Briefing · read before round 1',
    reading: `Round ${game?.round_number} · ${game?.node?.story_time ?? ''}`,
    discussion: game?.speaker ? `Speaking · ${room.members.find((m) => m.member_id === game.speaker?.member_id)?.display_name}` : 'Open discussion',
    voting: `Voting · ${game?.ballots_cast ?? 0} of ${game?.eligible_member_ids.length ?? 0} ballots`,
    tie: 'Tie · CEO decides',
    result: 'Outcome',
    debrief: 'Debrief',
  }
  return {
    seats,
    speakerId: game?.speaker?.member_id ?? null,
    screenTitle: room.phase === 'result' ? game?.last_result?.option_label ?? 'No decision' : game?.node?.title ?? game?.scenario.title ?? '',
    screenSubtitle: subtitle[room.phase] ?? room.phase,
    deadline: game?.deadline_at ?? null,
  }
}
