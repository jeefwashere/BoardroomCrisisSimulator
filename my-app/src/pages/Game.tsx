import { useEffect, useRef, useState } from 'react'
import { MotionConfig } from 'motion/react'
import type { RoomSnapshot, Scenario } from '../services/rooms'
import { roomMembers } from '../features/rooms/roomState'
import { roomApi, errorMessage } from '../features/rooms/useRoom'
import LobbyIcon from '../features/lobby/LobbyIcon'
import CallGrid from '../features/game/CallGrid'
import TurnMedia from '../features/game/TurnMedia'
import RoomNameEditor from '../features/rooms/RoomNameEditor'
import './Game.css'

function Countdown({ deadline, serverTime }: { deadline?: string | null; serverTime?: string }) {
    const [elapsed, setElapsed] = useState(0)
    useEffect(() => { const started = performance.now(); const timer = setInterval(() => setElapsed(performance.now() - started), 200); return () => clearInterval(timer) }, [deadline, serverTime])
    const remaining = deadline && serverTime ? Math.max(0, Math.ceil((Date.parse(deadline) - Date.parse(serverTime) - elapsed) / 1000)) : null
    return remaining === null ? null : <span className="game-countdown" aria-label="Seconds remaining">{remaining}s remaining</span>
}

function Game({ room, scenarios, error, rename, execute }: { room: RoomSnapshot; scenarios: Scenario[]; error: string; rename: (name: string) => Promise<void>; execute: (path: string, fields?: Record<string, unknown>) => Promise<void> }) {
    const [notice, setNotice] = useState('')
    const [pending, setPending] = useState(false)
    const [text, setText] = useState('')
    const [proposal, setProposal] = useState('')
    const [ceo, setCeo] = useState('')
    const [speech, setSpeech] = useState({ phaseId: '', url: '' })
    const speechRef = useRef<HTMLAudioElement>(null)
    const game = room.game
    useEffect(() => { const audio = speechRef.current; return () => { audio?.pause(); if (speech.url) URL.revokeObjectURL(speech.url) } }, [speech.url, game?.phase_id])
    if (!game) return null
    const scenario = scenarios.find((option) => option.scenario_id === game.scenario.scenario_id && option.version === game.scenario.version)
    const self = room.members.find((member) => member.member_id === room.self_member_id)
    const actions = game.allowed_actions ?? []
    const rounds = `rounds/${game.round_id}/`
    async function act(path: string, fields: Record<string, unknown> = {}) {
        if (pending) return false
        setPending(true); setNotice('')
        try { await execute(path, fields); return true }
        catch (failure) { setNotice(errorMessage(failure)); return false }
        finally { setPending(false) }
    }
    async function narrate() {
        if (!game?.narration) return
        try {
            const status = await roomApi.prepareNarration(room.room_id, game.narration.narration_id)
            if (status.status !== 'ready') { setNotice(status.error || 'Spoken narration is disabled. The consequence remains readable.'); return }
            const blob = await roomApi.narration(room.room_id, game.narration.narration_id)
            setSpeech({ phaseId: game.phase_id, url: URL.createObjectURL(blob) })
        } catch (failure) { setNotice(errorMessage(failure)) }
    }
    const speaker = room.members.find((member) => member.member_id === game.active_speaker_id)
    return <MotionConfig reducedMotion="user"><div className="game-call-screen game-live-screen">
        <header className="game-call-header">
            <div className="room-personal-controls"><button className="game-back-button" type="button" onClick={() => { window.location.hash = '/' }}><LobbyIcon name="back" /><span>Leave room</span></button><RoomNameEditor room={room} rename={rename} /></div>
            <div className="game-call-heading"><h1>Boardroom</h1><span>{room.phase.replaceAll('_', ' ')} · {room.room_code}</span></div>
            <span className="game-player-count">{room.members.length} / {room.capacity}</span>
        </header>
        <main className="game-call-main game-live-main"><CallGrid members={roomMembers(room, {}, scenario)} />
            <section className="game-briefing" aria-labelledby="briefing-title">
                <h2 id="briefing-title">{game.scenario.title}</h2>
                <p className="game-phase" role="status">{room.phase.replaceAll('_', ' ')} · Round {game.round_number} <Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} /></p>
                {self && <p>Your role: {scenario?.roles.find((role) => role.role_id === self.role_id)?.name ?? self.role_id}. {self.eligible_current_round ? 'You participate in this round.' : `You join from round ${self.eligible_from_round}.`}</p>}
                {(error || notice) && <p role="alert">{error || notice}</p>}
                {game.current_node && <article><h3>{game.current_node.title}</h3><p>{game.current_node.situation}</p>{game.current_node.study_questions.map((question) => <p key={question}>{question}</p>)}</article>}
                {speaker && <p className="game-speaker"><strong>{speaker.display_name} has the floor.</strong></p>}
                <div className="game-actions">
                    {actions.includes('finish_speaking') && <button disabled={pending} onClick={() => void act(rounds + 'speaker/finish')}>Finish my turn</button>}
                    {actions.includes('skip_speaker') && <button disabled={pending} onClick={() => { const reason = window.prompt('Reason for skipping this speaker'); if (reason?.trim()) void act(rounds + 'speaker/skip', { reason }) }}>Skip speaker</button>}
                    {actions.includes('reassign_ceo') && <><label>Replacement CEO<select value={ceo} onChange={(event) => setCeo(event.target.value)}><option value="">Choose a participant</option>{room.members.filter((member) => member.connected && member.eligible_current_round && member.role_id !== 'ceo').map((member) => <option key={member.member_id} value={member.member_id}>{member.display_name}</option>)}</select></label><button disabled={pending || !ceo} onClick={() => void act(rounds + 'ceo-reassignment', { member_id: ceo })}>Assign CEO</button></>}
                </div>
                {(actions.includes('vote') || actions.includes('tie_decision')) && <fieldset disabled={pending}><legend>{room.phase === 'tie_break' ? 'Choose among the tied leaders' : 'Choose your vote. You can change it until the deadline.'}</legend>{game.current_node?.options.filter((option) => room.phase !== 'tie_break' || game.tied_option_ids?.includes(option.option_id)).map((option) => <button key={option.option_id} aria-pressed={game.self_vote === option.option_id} onClick={() => void act(rounds + (room.phase === 'tie_break' ? 'tie-decision' : 'vote'), { option_id: option.option_id })}>{option.label}{game.self_vote === option.option_id ? ' (your vote)' : ''}</button>)}</fieldset>}
                {game.vote_counts && Object.keys(game.vote_counts).length > 0 && <p>Final vote counts: {Object.entries(game.vote_counts).map(([option, count]) => `${game.current_node?.options.find((item) => item.option_id === option)?.label ?? option}: ${count}`).join(', ')}</p>}
                {['speaking', 'discussion'].includes(room.phase) && self?.eligible_current_round && <form onSubmit={(event) => { event.preventDefault(); void act('contributions', { kind: 'answer', source: 'typed', text }).then((ok) => { if (ok) setText('') }) }}><label>Your answer<textarea required maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} /></label><button disabled={pending || !text.trim()}>Save answer</button></form>}
                {actions.includes('proposal') && <form onSubmit={(event) => { event.preventDefault(); void act(rounds + 'proposal', { text: proposal }) }}><label>Custom action<textarea required maxLength={1000} value={proposal} onChange={(event) => setProposal(event.target.value)} /></label><button disabled={pending || !proposal.trim()}>Save custom action</button>{game.proposals?.some((item) => item.member_id === room.self_member_id) && <button type="button" disabled={pending} onClick={() => void act(rounds + 'proposal', { text: '' })}>Withdraw action</button>}</form>}
                {room.phase !== 'ended' && <form onSubmit={(event) => { event.preventDefault(); void act('contributions', { kind: 'chat', source: 'typed', text }).then((ok) => { if (ok) setText('') }) }}><label>Discussion message<textarea required maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} /></label><button disabled={pending || !text.trim()}>Send message</button></form>}
                {game.resolution && <p role="status">Custom action evaluation: {game.resolution.status}. {game.resolution.error}</p>}
                {actions.includes('retry_resolution') && <button disabled={pending} onClick={() => void act(rounds + 'resolution/retry')}>Retry custom evaluation</button>}
                {game.last_result && <article className="game-result"><h3>{room.phase === 'ended' ? 'Final consequence' : 'What happened'}</h3><p>{game.last_result.text}</p>{game.narration && <button type="button" onClick={() => void narrate()}>Play consequence</button>}{speech.url && speech.phaseId === game.phase_id && <audio ref={speechRef} controls src={speech.url} onPlaying={() => { if (game.narration) void roomApi.narrationEvent(room.room_id, game.narration.narration_id, 'started') }} onEnded={() => { if (game.narration) void roomApi.narrationEvent(room.room_id, game.narration.narration_id, 'completed') }} />}</article>}
                {room.phase === 'ended' && <section><h3>Final report</h3><p>Ending: {game.ending_label?.replaceAll('_', ' ')}</p>{game.history?.map((record) => <article key={record.decision_id}><h4>Round {record.round_number}: {record.selected_option_label ?? 'No decision'}</h4><p>{record.text}</p></article>)}</section>}
                <TurnMedia room={room} />
                <details open={room.phase === 'briefing'}><summary>Public scenario documents</summary>{game.public_documents.map((document) => <article key={document.id} className="game-public-document"><h3>{document.id.replaceAll('_', ' ')}</h3><div>{document.text}</div></article>)}</details>
                {actions.includes('end') && <button className="game-end" disabled={pending} onClick={() => { if (window.confirm('End this meeting and preserve its records?')) void act('end') }}>End meeting</button>}
            </section>
        </main><footer className="game-call-footer"><p>Scenario {game.scenario.scenario_id}, version {game.scenario.version}. Room version {room.room_version}.</p></footer>
    </div></MotionConfig>
}
export default Game
