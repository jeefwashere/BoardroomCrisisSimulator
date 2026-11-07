import { useState } from 'react'
import { Markdown } from './Markdown'
import { clock, remaining, useNow } from './useNow'
import { METRIC_NAMES, ROLE_NAMES, humanize, type GameClient, type GameView, type Member, type RoomSnapshot } from '../game/types'

const PHASE_LABELS: Record<string, string> = {
  briefing: 'Briefing',
  reading: 'Reading',
  discussion: 'Discussion',
  voting: 'Vote',
  tie: 'CEO decision',
  result: 'Outcome',
  debrief: 'Debrief',
}

const DOC_TITLES: Record<string, string> = {
  briefing: 'Briefing',
  initial_evidence: 'Evidence',
  operations: 'Operations',
}

export function Hud({ room, client }: { room: RoomSnapshot; client: GameClient }) {
  const game = room.game!
  const [error, setError] = useState<string | null>(null)
  const act = (promise: Promise<void>) => promise.then(() => setError(null), (e: Error) => setError(e.message))
  return (
    <div className={`hud phase-${room.phase}`}>
      <TopBar room={room} game={game} />
      <SidePanel room={room} game={game} />
      <MembersPanel room={room} game={game} />
      <Dock room={room} game={game} client={client} act={act} />
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {room.phase === 'debrief' && <Debrief game={game} />}
      {client.kind === 'mock' && <MockControls client={client} phase={room.phase} />}
    </div>
  )
}

function TopBar({ room, game }: { room: RoomSnapshot; game: GameView }) {
  const now = useNow()
  const seconds = remaining(game.deadline_at, now)
  const total = game.deadline_at ? (game.deadline_at - game.phase_started_at) / 1000 : 0
  const progress = total && seconds !== null ? 1 - seconds / total : 0
  return (
    <header className="topbar panel">
      <div className="brand">
        <span className="eyebrow">
          <span /> {game.scenario.title}
        </span>
        <h1>
          {room.phase === 'briefing' || room.phase === 'debrief' ? PHASE_LABELS[room.phase] : `Round ${game.round_number} of ${game.round_count}`}
          {game.node && <em> · {game.node.story_time}</em>}
        </h1>
      </div>
      <div className="phase-clock" aria-live="polite">
        <span className="phase-pill">{PHASE_LABELS[room.phase] ?? room.phase}</span>
        <span className={`clock ${seconds !== null && seconds <= 10 ? 'urgent' : ''}`}>{clock(seconds)}</span>
        <span className="clock-track">
          <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </span>
      </div>
      <ul className="metrics" aria-label="Company metrics">
        {Object.entries(game.metrics).map(([key, value]) => {
          const delta = room.phase === 'result' ? game.last_result?.metric_deltas[key] : undefined
          return (
            <li key={key}>
              <span className="metric-name">{METRIC_NAMES[key] ?? key}</span>
              <span className="metric-bar">
                <span style={{ width: `${value}%` }} className={value < 40 ? 'low' : value >= 75 ? 'high' : ''} />
              </span>
              <span className="metric-value">
                {value}
                {delta ? <b className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? `+${delta}` : delta}</b> : null}
              </span>
            </li>
          )
        })}
      </ul>
    </header>
  )
}

function SidePanel({ room, game }: { room: RoomSnapshot; game: GameView }) {
  const [tab, setTab] = useState<string>('situation')
  const [open, setOpen] = useState(true)
  const hasNode = Boolean(game.node)
  const active = tab === 'situation' && !hasNode ? 'briefing' : tab
  const doc = game.public_documents.find((d) => d.id === active)
  const wide = room.phase === 'briefing'
  return (
    <aside className={`side panel ${open ? '' : 'collapsed'} ${wide ? 'wide' : ''}`}>
      <div className="tabs" role="tablist">
        {hasNode && (
          <button role="tab" aria-selected={active === 'situation'} onClick={() => setTab('situation')}>
            Situation
          </button>
        )}
        {game.public_documents.map((d) => (
          <button key={d.id} role="tab" aria-selected={active === d.id} onClick={() => setTab(d.id)}>
            {DOC_TITLES[d.id] ?? humanize(d.id)}
          </button>
        ))}
        <button className="collapse" aria-label={open ? 'Hide documents' : 'Show documents'} onClick={() => setOpen(!open)}>
          {open ? '‹' : '›'}
        </button>
      </div>
      {open && (
        <div className="side-body">
          {active === 'situation' && game.node ? (
            <div className="situation">
              <span className="kicker">{game.node.story_time} · Decision {game.round_number}</span>
              <h2>{game.node.title}</h2>
              <p className="inject">{game.node.inject}</p>
              <h4>Questions to settle</h4>
              <ul className="questions">
                {game.node.study_questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              {game.history.length > 0 && (
                <>
                  <h4>So far</h4>
                  <ol className="so-far">
                    {game.history.map((h) => (
                      <li key={h.round_number}>{h.summary}</li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          ) : (
            doc && <Markdown text={doc.text} />
          )}
        </div>
      )}
    </aside>
  )
}

function MembersPanel({ room, game }: { room: RoomSnapshot; game: GameView }) {
  const speaking = game.speaker?.member_id
  return (
    <aside className="members panel" aria-label="Players">
      <h3>
        At the table <span>{room.members.length}</span>
      </h3>
      <ul>
        {room.members.map((m) => (
          <li key={m.member_id} className={[m.member_id === speaking && 'speaking', !m.connected && 'away'].filter(Boolean).join(' ')}>
            <span className="avatar-dot">{m.display_name.charAt(0)}</span>
            <span className="who">
              <strong>
                {m.display_name}
                {m.member_id === room.self_member_id && <small> you</small>}
              </strong>
              <span>{m.role_id ? ROLE_NAMES[m.role_id] : 'No role'}</span>
            </span>
            <span className="badges">
              {m.role_id === 'ceo' && <span className="badge">CEO</span>}
              {m.member_id === speaking && <span className="badge live">Live</span>}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

interface DockProps {
  room: RoomSnapshot
  game: GameView
  client: GameClient
  act: (p: Promise<void>) => void
}

function Dock(props: DockProps) {
  const { room } = props
  return (
    <section className="dock panel" aria-live="polite">
      {room.phase === 'briefing' && <BriefingDock {...props} />}
      {room.phase === 'reading' && <ReadingDock {...props} />}
      {room.phase === 'discussion' && <DiscussionDock {...props} />}
      {room.phase === 'voting' && <VotingDock {...props} />}
      {room.phase === 'tie' && <TieDock {...props} />}
      {room.phase === 'result' && <ResultDock {...props} />}
      {room.phase === 'debrief' && <p className="dock-note">The game has ended. Review the debrief.</p>}
    </section>
  )
}

function BriefingDock({ room }: DockProps) {
  const self = room.members.find((m) => m.member_id === room.self_member_id)
  return (
    <div className="dock-row">
      <div>
        <span className="kicker">Your seat</span>
        <h3>{self?.role_id ? ROLE_NAMES[self.role_id] : 'Observer'}</h3>
        <p className="dock-note">Read the briefing, the evidence and the operations notes. Everyone sees the same documents; no role has private facts.</p>
      </div>
    </div>
  )
}

function ReadingDock({ game }: DockProps) {
  return (
    <div className="dock-row">
      <div>
        <span className="kicker">New development · {game.node?.story_time}</span>
        <h3>{game.node?.title}</h3>
        <p className="dock-note">Study the situation. Discussion starts when the timer ends.</p>
      </div>
      <ol className="option-preview">
        {game.node?.options.map((o, i) => (
          <li key={o.id}>
            <b>{String.fromCharCode(65 + i)}</b> {o.label}
          </li>
        ))}
      </ol>
    </div>
  )
}

function DiscussionDock({ room, game, client, act }: DockProps) {
  const now = useNow()
  const speaker = room.members.find((m) => m.member_id === game.speaker?.member_id)
  const seconds = remaining(game.speaker?.ends_at, now)
  const isMe = speaker?.member_id === room.self_member_id
  const index = game.speaker ? game.speaker_order.indexOf(game.speaker.member_id) : game.speaker_order.length
  return (
    <div className="dock-row">
      <div className="speaker-now">
        <span className="kicker">{speaker ? 'Now speaking' : 'Open discussion'}</span>
        <h3>
          {speaker ? (isMe ? 'Your turn' : speaker.display_name) : 'Anyone may speak'}
          {speaker?.role_id && <small> · {ROLE_NAMES[speaker.role_id]}</small>}
        </h3>
        {speaker && (
          <div className="turn-clock">
            <span className="clock small">{clock(seconds)}</span>
            {isMe && (
              <button className="button primary" onClick={() => act(client.finishTurn())}>
                Finish my turn
              </button>
            )}
          </div>
        )}
        {!speaker && <p className="dock-note">Turns are done. Remaining time is open until the vote.</p>}
      </div>
      <ol className="turn-order" aria-label="Speaking order">
        {game.speaker_order.map((id, i) => {
          const member = room.members.find((m) => m.member_id === id)
          return (
            <li key={id} className={i < index ? 'done' : i === index ? 'current' : ''}>
              {member?.display_name.charAt(0)}
              <span>{member?.member_id === room.self_member_id ? 'You' : member?.display_name}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function VotingDock({ room, game, client, act }: DockProps) {
  const eligible = game.eligible_member_ids.includes(room.self_member_id)
  return (
    <div className="vote">
      <div className="vote-head">
        <span className="kicker">Cast one vote · you can change it until the timer ends</span>
        <span className="ballots">
          {game.ballots_cast} of {game.eligible_member_ids.length} voted
        </span>
      </div>
      <div className="options">
        {game.node?.options.map((o, i) => (
          <button
            key={o.id}
            className={`option ${game.my_ballot === o.id ? 'chosen' : ''}`}
            disabled={!eligible}
            aria-pressed={game.my_ballot === o.id}
            onClick={() => act(client.castVote(o.id))}
          >
            <b>{String.fromCharCode(65 + i)}</b>
            <span>{o.label}</span>
            {game.my_ballot === o.id && <em>Your vote</em>}
          </button>
        ))}
      </div>
      <p className="dock-note">{eligible ? 'Ballots stay private until voting closes. Not voting counts as abstaining.' : 'You joined after this decision began, so you vote from the next round.'}</p>
    </div>
  )
}

function TieDock({ room, game, client, act }: DockProps) {
  const isCeo = game.tie?.ceo_member_id === room.self_member_id
  const ceo = room.members.find((m) => m.member_id === game.tie?.ceo_member_id)
  const tied = game.node?.options.filter((o) => game.tie?.option_ids.includes(o.id)) ?? []
  return (
    <div className="vote">
      <div className="vote-head">
        <span className="kicker">Tie · {isCeo ? 'you decide as CEO' : `${ceo?.display_name ?? 'The CEO'} is deciding`}</span>
        <span className="ballots">No choice by the deadline means no decision</span>
      </div>
      <div className="options">
        {tied.map((o) => (
          <button key={o.id} className="option" disabled={!isCeo} onClick={() => act(client.ceoChoose(o.id))}>
            <b>{String.fromCharCode(65 + (game.node?.options.indexOf(o) ?? 0))}</b>
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ResultDock({ game }: DockProps) {
  const r = game.last_result
  if (!r) return null
  const total = Object.values(r.tally).reduce((a, b) => a + b, 0)
  return (
    <div className="result">
      <div>
        <span className="kicker">
          Decision {r.round_number} · {r.decided_by === 'vote' ? 'chosen by vote' : r.decided_by === 'ceo_tie' ? 'tie broken by the CEO' : 'no decision'}
        </span>
        <h3>{r.option_label ?? 'The room did not decide in time'}</h3>
        <p className="summary">{r.summary}</p>
      </div>
      <ul className="tally">
        {game.node?.options.map((o, i) => (
          <li key={o.id} className={o.id === r.option_id ? 'won' : ''}>
            <b>{String.fromCharCode(65 + i)}</b>
            <span className="tally-bar">
              <span style={{ width: `${total ? (r.tally[o.id] / total) * 100 : 0}%` }} />
            </span>
            <span>{r.tally[o.id] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Debrief({ game }: { game: GameView }) {
  return (
    <div className="debrief-backdrop">
      <article className="debrief panel">
        <span className="eyebrow">
          <span /> Debrief
        </span>
        <h2>{humanize(game.ending_label) || 'Game over'}</h2>
        <div className="final-metrics">
          {Object.entries(game.metrics).map(([key, value]) => (
            <div key={key}>
              <span className="big">{value}</span>
              <span>{METRIC_NAMES[key] ?? key}</span>
            </div>
          ))}
        </div>
        <ol className="timeline">
          {game.history.map((h) => (
            <li key={h.round_number}>
              <span className="kicker">
                Decision {h.round_number} · {h.node_title}
              </span>
              <strong>{h.option_label ?? 'No decision'}</strong>
              <p>{h.summary}</p>
            </li>
          ))}
        </ol>
        <h4>Talk it through</h4>
        <ul className="questions">
          {game.debrief_questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
        <p className="dock-note">Fictional teaching values. These numbers are not real measures of protection, availability or risk.</p>
      </article>
    </div>
  )
}

function MockControls({ client, phase }: { client: GameClient; phase: string }) {
  return (
    <div className="mock-controls">
      <span>Mock game</span>
      <button onClick={() => client.skipPhase?.()}>Skip ›</button>
      {phase === 'voting' && <button onClick={() => client.forceTie?.()}>Force tie</button>}
    </div>
  )
}

export function memberMood(member: Member, room: RoomSnapshot): 'sit' | 'talk' | 'disbelief' | 'typing' {
  const game = room.game
  if (!game) return 'sit'
  if (room.phase === 'discussion') {
    if (game.speaker?.member_id === member.member_id) return 'talk'
    return 'sit'
  }
  if (room.phase === 'voting') return 'typing'
  if (room.phase === 'result' && game.last_result) {
    const net = Object.values(game.last_result.metric_deltas).reduce((a, b) => a + b, 0)
    return net < 0 ? 'disbelief' : 'sit'
  }
  return 'sit'
}
