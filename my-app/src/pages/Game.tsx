import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import type { RoomSnapshot, Scenario } from '../services/rooms'
import { roomMembers } from '../features/rooms/roomState'
import { roomApi, errorMessage } from '../features/rooms/useRoom'
import CallGrid from '../features/game/CallGrid'
import type { TileBadge } from '../features/game/CallGrid'
import CallIcon from '../features/game/CallIcon'
import { callControls } from '../features/game/callControls'
import Countdown from '../features/game/Countdown'
import OpeningBriefing from '../features/game/OpeningBriefing'
import VotingPanel from '../features/game/VotingPanel'
import TurnMedia from '../features/game/TurnMedia'
import SavedClipTurn from '../features/game/SavedClipTurn'
import { FacilitationPanel } from '../features/facilitation'
import RoomCodeButton from '../features/lobby/RoomCodeButton'
import './Game.css'
import './GameWorkspace.css'

const SKIP_LABELS: Record<string, string> = { briefing: 'Skip briefing', reading: 'Skip reading', voting: 'Close voting now', tie_break: 'Skip tie break', result: 'Continue' }

function Game({ room, scenarios, error, execute, onLeaveRoom, leaveLabel = 'Leave room' }: { room: RoomSnapshot; scenarios: Scenario[]; error: string; execute: (path: string, fields?: Record<string, unknown>) => Promise<void>; onLeaveRoom?: () => void; leaveLabel?: string }) {
    const [notice, setNotice] = useState('')
    const [pending, setPending] = useState(false)
    const pendingRef = useRef(false)
    const [text, setText] = useState('')
    const [drawerOpen, setDrawerOpen] = useState(true)
    const [writing, setWriting] = useState(false)
    const [dismissedOpening, setDismissedOpening] = useState('')
    const [proposal, setProposal] = useState('')
    const [ceo, setCeo] = useState('')
    const [speech, setSpeech] = useState({ phaseId: '', url: '' })
    const [captureTarget, setCaptureTarget] = useState<HTMLDivElement | null>(null)
    const [archiveTarget, setArchiveTarget] = useState<HTMLDivElement | null>(null)
    const [feedbackTarget, setFeedbackTarget] = useState<HTMLDivElement | null>(null)
    const incidentButton = useRef<HTMLButtonElement>(null)
    const speechRef = useRef<HTMLAudioElement>(null)
    const game = room.game
    const controls = callControls(room)
    useEffect(() => { const audio = speechRef.current; return () => { audio?.pause(); if (speech.url) URL.revokeObjectURL(speech.url) } }, [speech.url, game?.phase_id])
    useEffect(() => {
        function escape(event: KeyboardEvent) {
            if (event.key === 'Escape') { setDrawerOpen(false); setWriting(false); incidentButton.current?.focus() }
        }
        window.addEventListener('keydown', escape)
        return () => window.removeEventListener('keydown', escape)
    }, [])
    if (!game) return null
    const scenario = scenarios.find((option) => option.scenario_id === game.scenario.scenario_id && option.version === game.scenario.version)
    const self = room.members.find((member) => member.member_id === room.self_member_id)
    const actions = game.allowed_actions ?? []
    const rounds = `rounds/${game.round_id}/`
    async function act(path: string, fields: Record<string, unknown> = {}) {
        if (pendingRef.current) return false
        pendingRef.current = true; setPending(true); setNotice('')
        try { await execute(path, fields); return true }
        catch (failure) { setNotice(errorMessage(failure)); return false }
        finally { pendingRef.current = false; setPending(false) }
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
    const opening = room.phase === 'briefing' && dismissedOpening !== game.phase_id
    const badges: Record<string, TileBadge> = {}
    if (speaker && room.phase === 'speaking') badges[speaker.member_id] = { label: 'Speaking', tone: 'speaking' }
    if (room.phase === 'voting' && actions.includes('vote')) badges[room.self_member_id] = game.self_vote ? { label: 'Voted', tone: 'voted' } : { label: 'Decide now', tone: 'decide' }
    if (room.phase === 'tie_break' && actions.includes('tie_decision')) badges[room.self_member_id] = { label: 'Decide now', tone: 'decide' }
    const closeDrawer = () => { setDrawerOpen(false); incidentButton.current?.focus() }
    return <MotionConfig reducedMotion="user"><div className={`game-call-screen game-workspace${controls.reviewing ? ' is-reviewing' : ''}`}>
        <header className="game-call-header">
            <div className="game-self-name">{self?.display_name}<span>{scenario?.roles.find((role) => role.role_id === self?.role_id)?.name ?? self?.role_id}</span></div>
            <div className="game-call-heading"><h1>Boardroom</h1><span className="game-room-meta"><span>{room.phase.replaceAll('_', ' ')}</span><RoomCodeButton key={room.room_code} code={room.room_code} compact /></span></div>
            <span className="game-player-count">{room.members.length} / {room.capacity}</span>
        </header>
        <main className={`game-workspace-main${drawerOpen && !controls.reviewing && !opening ? ' has-incident' : ''}`}>
            {controls.reviewing ? <section className="game-round-review game-briefing" aria-labelledby="round-review-title" key={game.phase_id}>
                <span className="game-eyebrow">{room.phase === 'ended' ? 'Session complete' : `Round ${game.round_number} complete`}</span>
                <h2 id="round-review-title">{room.phase === 'ended' ? 'Session summary' : 'Post-round summary'}</h2>
                <p className="game-review-scenario">{game.scenario.title}</p>
                {game.last_result ? <article className="game-review-outcome"><span className="game-eyebrow">{game.last_result.selected_option_label ?? 'No decision recorded'}</span><h3>What happened</h3><p>{game.last_result.text}</p>
                    {game.narration && <button type="button" onClick={() => void narrate()}>Listen to consequence</button>}
                    {speech.url && speech.phaseId === game.phase_id && <audio ref={speechRef} controls src={speech.url} onPlaying={() => { if (game.narration) void roomApi.narrationEvent(room.room_id, game.narration.narration_id, 'started') }} onEnded={() => { if (game.narration) void roomApi.narrationEvent(room.room_id, game.narration.narration_id, 'completed') }} />}
                </article> : <p>No decision was completed before the session ended.</p>}
                {room.phase === 'ended' && <details className="game-review-history"><summary>Round history</summary>{game.history?.map((record) => <article key={record.decision_id}><h3>Round {record.round_number}: {record.selected_option_label ?? 'No decision'}</h3><p>{record.text}</p></article>)}</details>}
                <FacilitationPanel room={room} review feedbackContent={<div ref={setFeedbackTarget} />} recordingsContent={<div ref={setArchiveTarget} />} documentsContent={<div className="game-public-documents">{game.public_documents.map((document) => <article key={document.id} className="game-public-document"><h3>{document.id.replaceAll('_', ' ')}</h3><div>{document.text}</div></article>)}</div>} />
                {room.phase === 'result' && <p className="game-review-next">The next round begins automatically. <Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} /></p>}
            </section> : <>
                {opening ? <OpeningBriefing room={room} onDismiss={() => setDismissedOpening(game.phase_id)} finishBriefing={actions.includes('finish_briefing') ? () => act(rounds + 'briefing/finish') : undefined} />
                    : <div className="game-participant-stage"><div className="game-stage-status"><span>{speaker && room.phase === 'speaking' ? `${speaker.display_name} has the floor` : room.phase.replaceAll('_', ' ')}</span><Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} /></div><CallGrid members={roomMembers(room, {}, scenario)} badges={badges} /></div>}
                <AnimatePresence>
                    {drawerOpen && !opening && <motion.aside key="incident" id="incident-drawer" className="game-incident-drawer game-briefing" aria-labelledby="incident-title" initial={{ x: '110%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '110%', opacity: 0 }} transition={{ type: 'spring', stiffness: 310, damping: 34 }}>
                        <header className="game-sheet-heading"><span className="game-eyebrow">Incident brief · Round {game.round_number}</span><button type="button" className="game-icon-button" aria-label="Close incident summary" onClick={closeDrawer}><CallIcon name="close" /></button></header>
                        <h2 id="incident-title">Incident summary</h2><p className="game-incident-scenario">{game.scenario.title}</p>
                        {game.current_node && <article><h3>{game.current_node.title}</h3><p>{game.current_node.situation}</p><ul className="game-study-questions">{game.current_node.study_questions.map((question) => <li key={question}>{question}</li>)}</ul></article>}
                        {!game.current_node && <p>The briefing is being prepared.</p>}
                        <details className="game-saved-clips"><summary>Saved clips<span aria-hidden="true">+</span></summary><SavedClipTurn room={room} pending={pending} act={act} finishPath={rounds + 'speaker/finish'} /><div ref={setArchiveTarget} /></details>
                    </motion.aside>}
                </AnimatePresence>
                {['voting', 'tie_break', 'resolving', 'resolution_failed'].includes(room.phase) && <section className="game-decision-workspace game-briefing" aria-label="Round decision"><VotingPanel key={game.round_id} room={room} pending={pending} act={act} />
                    {game.resolution && <p role="status">Custom action evaluation: {game.resolution.status}. {game.resolution.error}</p>}
                    {actions.includes('retry_resolution') && <button disabled={pending} onClick={() => void act(rounds + 'resolution/retry')}>Retry custom evaluation</button>}
                    {actions.includes('reassign_ceo') && <div className="game-actions"><label>Replacement CEO<select value={ceo} onChange={(event) => setCeo(event.target.value)}><option value="">Choose a participant</option>{room.members.filter((member) => member.connected && member.eligible_current_round && member.role_id !== 'ceo').map((member) => <option key={member.member_id} value={member.member_id}>{member.display_name}</option>)}</select></label><button disabled={pending || !ceo} onClick={() => void act(rounds + 'ceo-reassignment', { member_id: ceo })}>Assign CEO</button></div>}
                </section>}
            </>}
        </main>
        <AnimatePresence>{writing && controls.canWrite && <motion.section className="game-answer-composer game-briefing" aria-labelledby="answer-title" initial={{ y: 25, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 25, opacity: 0 }}>
            <header className="game-sheet-heading"><h2 id="answer-title">Your input</h2><button type="button" className="game-icon-button" aria-label="Close text input" onClick={() => setWriting(false)}><CallIcon name="close" /></button></header>
            <form onSubmit={(event) => { event.preventDefault(); void act('contributions', { kind: 'answer', source: 'typed', text }).then((ok) => { if (ok) { setText(''); setWriting(false) } }) }}><label>Your answer<textarea autoFocus required maxLength={4000} rows={3} value={text} onChange={(event) => setText(event.target.value)} /></label><button disabled={pending || !text.trim()}>Save answer</button></form>
            {actions.includes('proposal') && <details><summary>Propose a custom action</summary><form onSubmit={(event) => { event.preventDefault(); void act(rounds + 'proposal', { text: proposal }) }}><label>Custom action<textarea required value={proposal} onChange={(event) => setProposal(event.target.value)} /></label><button disabled={pending || !proposal.trim()}>Save custom action</button>{game.proposals?.some((item) => item.member_id === room.self_member_id) && <button type="button" disabled={pending} onClick={() => void act(rounds + 'proposal', { text: '' })}>Withdraw action</button>}</form></details>}
        </motion.section>}</AnimatePresence>
        {(error || notice) && <p className="game-call-notice" role="alert">{error || notice}</p>}
        <footer className="game-control-dock" aria-label="Call controls">
            <div ref={setCaptureTarget} className="game-capture-slot" />
            {!controls.reviewing && <button ref={incidentButton} type="button" aria-expanded={drawerOpen && !opening} aria-controls="incident-drawer" disabled={opening} onClick={() => { setDrawerOpen((value) => !value); setWriting(false) }}><CallIcon name="incident" /><span>Incident</span></button>}
            {!controls.reviewing && <button type="button" aria-expanded={writing && controls.canWrite} disabled={!controls.canWrite} onClick={() => { setWriting((value) => !value); setDrawerOpen(false) }}><CallIcon name="text" /><span>Text input</span></button>}
            {!controls.reviewing && <button className="game-control-primary" type="button" disabled={pending || !controls.canFinish} onClick={() => void act(rounds + 'speaker/finish')}><CallIcon name="finish" /><span>Finish my turn</span></button>}
            {controls.canSkipTurn && <button type="button" disabled={pending} onClick={() => { const reason = window.prompt('Reason for skipping this turn'); if (reason?.trim()) void act(rounds + 'speaker/skip', { reason }) }}><CallIcon name="skip" /><span>Skip turn</span></button>}
            {controls.canFinishRound && <button type="button" disabled={pending} title="End discussion and continue to voting. Votes are still required." onClick={() => { if (window.confirm('Finish discussion for this round and continue to voting?')) void act(rounds + 'skip-phase') }}><CallIcon name="finish" /><span>Finish round</span></button>}
            {actions.includes('skip_phase') && !controls.canFinishRound && <button type="button" disabled={pending} onClick={() => void act(rounds + 'skip-phase')}><CallIcon name="skip" /><span>{SKIP_LABELS[room.phase] ?? 'Skip phase'}</span></button>}
            <span className="game-control-divider" aria-hidden="true" />
            <button className="game-control-leave" type="button" onClick={() => { if (onLeaveRoom) onLeaveRoom(); else window.location.hash = '/' }}><CallIcon name="leave" /><span>{leaveLabel}</span></button>
        </footer>
        <TurnMedia room={room} portalMode controlsTarget={captureTarget} archiveTarget={archiveTarget} feedbackTarget={feedbackTarget} />
    </div></MotionConfig>
}
export default Game
