import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import type { RoomSnapshot, Scenario } from '../services/rooms'
import { roomMembers } from '../features/rooms/roomState'
import { roomApi, errorMessage } from '../features/rooms/useRoom'
import LobbyIcon from '../features/lobby/LobbyIcon'
import CallGrid from '../features/game/CallGrid'
import type { TileBadge } from '../features/game/CallGrid'
import Countdown from '../features/game/Countdown'
import OpeningBriefing from '../features/game/OpeningBriefing'
import ExpertPanelStage from '../features/game/ExpertPanelStage'
import { showsExpertStage } from '../features/game/expertPanelModel'
import VotingPanel from '../features/game/VotingPanel'
import IndividualDecisionPanel from '../features/game/IndividualDecisionPanel'
import IndividualDecisionReport from '../features/game/IndividualDecisionReport'
import { decisionBadges, isIndividualMode, roundLabel } from '../features/game/individualDecisionModel'
import TurnMedia from '../features/game/TurnMedia'
import SavedClipTurn from '../features/game/SavedClipTurn'
import RoomNameEditor from '../features/rooms/RoomNameEditor'
import './Game.css'

const SKIP_LABELS: Record<string, string> = {
    briefing: 'Skip briefing', reading: 'Skip reading', speaking: 'Skip remaining turns',
    discussion: 'Skip discussion', individual_decision: 'Close decisions', voting: 'Record final decision', tie_break: 'Skip tie break', result: 'Continue',
}

function Game({ room, scenarios, error, rename, execute, onViewSummary }: { room: RoomSnapshot; scenarios: Scenario[]; error: string; rename: (name: string) => Promise<void>; execute: (path: string, fields?: Record<string, unknown>) => Promise<void>; onViewSummary: () => void }) {
    const [notice, setNotice] = useState('')
    const [pending, setPending] = useState(false)
    const [text, setText] = useState('')
    const [dismissedOpening, setDismissedOpening] = useState('')
    const [proposal, setProposal] = useState('')
    const [ceo, setCeo] = useState('')
    const [speech, setSpeech] = useState({ phaseId: '', url: '' })
    const speechRef = useRef<HTMLAudioElement>(null)
    const [ownDecision, setOwnDecision] = useState<string | null>(null)
    const game = room.game
    // Keep the caller's last recorded decision so the ended report can show it even if that projection omits it.
    const seenDecision = game?.individual_decisions?.self?.text
    if (seenDecision && seenDecision !== ownDecision) setOwnDecision(seenDecision)
    useEffect(() => { const audio = speechRef.current; return () => { audio?.pause(); if (speech.url) URL.revokeObjectURL(speech.url) } }, [speech.url, game?.phase_id])
    if (!game) return null
    const scenario = scenarios.find((option) => option.scenario_id === game.scenario.scenario_id && option.version === game.scenario.version)
    const self = room.members.find((member) => member.member_id === room.self_member_id)
    const actions = game.allowed_actions ?? []
    const rounds = `rounds/${game.round_id}/`
    // Individual decision scenarios (Cedar T01) replace the board vote with one written decision per member.
    const individual = isIndividualMode(game)
    const round = roundLabel(room.phase, game)
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
    // The AI opening owns the stage before the call splits into the participant grid.
    const opening = room.phase === 'briefing' && dismissedOpening !== game.phase_id
    // After the turns, the AI experts take the full stage one after another before voting opens.
    const experts = !opening && showsExpertStage(room.phase, game.discussion_mode)
    const fullStage = opening || experts
    // Advisers, recorded audio and documents stay out of the way until the round's decision is made.
    const layout = fullStage ? ' game-live-main--opening' : ' game-live-main--focus'
    // Only the caller's own ballot is known, so ballot badges are limited to the self tile.
    const badges: Record<string, TileBadge> = room.phase === 'individual_decision' ? decisionBadges(game.individual_decisions, room.self_member_id) : {}
    if (speaker && room.phase === 'speaking') badges[speaker.member_id] = { label: 'Speaking', tone: 'speaking' }
    if (room.phase === 'voting' && actions.includes('vote')) badges[room.self_member_id] = game.self_vote ? { label: 'Voted', tone: 'voted' } : { label: 'Decide now', tone: 'decide' }
    if (room.phase === 'tie_break' && actions.includes('tie_decision')) badges[room.self_member_id] = { label: 'Decide now', tone: 'decide' }
    return <MotionConfig reducedMotion="user"><div className="game-call-screen game-live-screen">
        <header className="game-call-header">
            <div className="room-personal-controls"><button className="game-back-button" type="button" onClick={() => { window.location.hash = '/' }}><LobbyIcon name="back" /><span>Leave room</span></button><RoomNameEditor room={room} rename={rename} /></div>
            <div className="game-call-heading"><h1>Boardroom</h1>{round && <span className="game-round-label">{round}</span>}<span>{room.phase.replaceAll('_', ' ')} · {room.room_code}</span></div>
            <span className="game-player-count">{room.members.length} / {room.capacity}</span>
        </header>
        <main className={`game-call-main game-live-main${layout}`}>
            <AnimatePresence mode="wait" initial={false}>
                {opening ? <OpeningBriefing key="opening" room={room} onDismiss={() => setDismissedOpening(game.phase_id)} finishBriefing={actions.includes('finish_briefing') ? () => act(rounds + 'briefing/finish') : undefined} />
                    : experts ? <ExpertPanelStage key={`experts-${game.round_id}`} room={room} notice={error || notice} finishPanel={actions.includes('skip_phase') ? () => act(rounds + 'skip-phase') : undefined} />
                    : <motion.div key="call" className="game-stage-call" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: 'easeOut' }}><CallGrid members={roomMembers(room, {}, scenario)} badges={badges} /></motion.div>}
            </AnimatePresence>
            {!fullStage && <section className="game-briefing" aria-labelledby="briefing-title">
                <h2 id="briefing-title">{game.scenario.title}</h2>
                <p className="game-phase" role="status">{room.phase.replaceAll('_', ' ')} · Round {game.round_number} <Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} /></p>
                {self && <p>Your role: {scenario?.roles.find((role) => role.role_id === self.role_id)?.name ?? self.role_id}. {self.eligible_current_round ? 'You participate in this round.' : `You join from round ${self.eligible_from_round}.`}</p>}
                {(error || notice) && <p role="alert">{error || notice}</p>}
                {individual && <IndividualDecisionPanel key={game.phase_id} room={room} pending={pending} act={act} notice={notice} />}
                {game.current_node && <article><h3>{game.current_node.title}</h3><p>{game.current_node.situation}</p>{game.current_node.study_questions.map((question) => <p key={question}>{question}</p>)}</article>}
                {speaker && <p className="game-speaker"><strong>{speaker.display_name} has the floor.</strong></p>}
                <div className="game-actions">
                    {actions.includes('finish_speaking') && <button disabled={pending} onClick={() => void act(rounds + 'speaker/finish')}>Finish my turn</button>}
                    {actions.includes('skip_phase') && <button className="game-skip-phase" disabled={pending} onClick={() => void act(rounds + 'skip-phase')}>{SKIP_LABELS[room.phase] ?? 'Skip phase'}</button>}
                    {actions.includes('skip_speaker') && <button disabled={pending} onClick={() => void act(rounds + 'speaker/skip', { reason: 'Skipped by the host' })}>Skip speaker</button>}
                    {actions.includes('reassign_ceo') && <><label>Replacement CEO<select value={ceo} onChange={(event) => setCeo(event.target.value)}><option value="">Choose a participant</option>{room.members.filter((member) => member.connected && member.eligible_current_round && member.role_id !== 'ceo').map((member) => <option key={member.member_id} value={member.member_id}>{member.display_name}</option>)}</select></label><button disabled={pending || !ceo} onClick={() => void act(rounds + 'ceo-reassignment', { member_id: ceo })}>Assign CEO</button></>}
                </div>
                <SavedClipTurn room={room} pending={pending} act={act} finishPath={rounds + 'speaker/finish'} />
                {!individual && <VotingPanel key={game.round_id} room={room} pending={pending} act={act} notice={notice} />}
                {['speaking', 'discussion'].includes(room.phase) && self?.eligible_current_round && <form onSubmit={(event) => { event.preventDefault(); void act('contributions', { kind: 'answer', source: 'typed', text }).then((ok) => { if (ok) setText('') }) }}><label>Your answer<textarea required maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} /></label><button disabled={pending || !text.trim()}>Save answer</button></form>}
                {actions.includes('proposal') && room.phase !== 'voting' && <form onSubmit={(event) => { event.preventDefault(); void act(rounds + 'proposal', { text: proposal }) }}><label>Custom action<textarea required value={proposal} onChange={(event) => setProposal(event.target.value)} /></label><button disabled={pending || !proposal.trim()}>Save custom action</button>{game.proposals?.some((item) => item.member_id === room.self_member_id) && <button type="button" disabled={pending} onClick={() => void act(rounds + 'proposal', { text: '' })}>Withdraw action</button>}</form>}
                {game.resolution && !['resolving', 'resolution_failed', 'decision', 'result'].includes(room.phase) && <p role="status">Custom action evaluation: {game.resolution.status}. {game.resolution.error}</p>}
                {actions.includes('retry_resolution') && <button disabled={pending} onClick={() => void act(rounds + 'resolution/retry')}>Retry custom evaluation</button>}
                {!individual && game.last_result && <article className="game-result"><h3>{room.phase === 'ended' ? 'Final consequence' : 'What happened'}</h3><p>{game.last_result.text}</p>{game.narration && <button type="button" onClick={() => void narrate()}>Play consequence</button>}{speech.url && speech.phaseId === game.phase_id && <audio ref={speechRef} controls src={speech.url} onPlaying={() => { if (game.narration) void roomApi.narrationEvent(room.room_id, game.narration.narration_id, 'started') }} onEnded={() => { if (game.narration) void roomApi.narrationEvent(room.room_id, game.narration.narration_id, 'completed') }} />}</article>}
                {room.phase === 'ended' && individual && <IndividualDecisionReport decisions={game.individual_decisions} ownText={game.individual_decisions?.self?.text ?? ownDecision} selfId={room.self_member_id} endingLabel={game.ending_label} />}
                {room.phase === 'ended' && !individual && <section><h3>Final report</h3><p>Ending: {game.ending_label?.replaceAll('_', ' ')}</p>{game.history?.map((record) => <article key={record.decision_id}><h4>Round {record.round_number}: {record.selected_option_label ?? 'No decision'}</h4><p>{record.text}</p></article>)}</section>}
                <TurnMedia room={room} />
                <details open={room.phase === 'briefing'}><summary>Public scenario documents</summary>{game.public_documents.map((document) => <article key={document.id} className="game-public-document"><h3>{document.id.replaceAll('_', ' ')}</h3><div>{document.text}</div></article>)}</details>
                {actions.includes('end') && <button className="game-end" disabled={pending} onClick={() => { if (window.confirm('End this meeting and preserve its records?')) void act('end') }}>End meeting</button>}
            </section>}
        </main><footer className="game-call-footer"><p>Scenario {game.scenario.scenario_id}, version {game.scenario.version}. Room version {room.room_version}.</p><button className="game-summary-button" type="button" onClick={onViewSummary}>Summary demo preview <span aria-hidden="true">↗</span></button></footer>
    </div></MotionConfig>
}
export default Game
