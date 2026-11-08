import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import type { RoomSnapshot, Scenario } from '../services/rooms'
import { roomMembers } from '../features/rooms/roomState'
import { roomApi, errorMessage } from '../features/rooms/useRoom'
import type { RoomChatHandle } from '../features/rooms/useRoomChat'
import LobbyIcon from '../features/lobby/LobbyIcon'
import CallGrid from '../features/game/CallGrid'
import type { TileBadge } from '../features/game/CallGrid'
import OpeningBriefing from '../features/game/OpeningBriefing'
import ExpertPanelStage from '../features/game/ExpertPanelStage'
import { showsExpertStage } from '../features/game/expertPanelModel'
import VotingPanel from '../features/game/VotingPanel'
import IndividualDecisionPanel from '../features/game/IndividualDecisionPanel'
import type { AttachDictation } from '../features/game/IndividualDecisionPanel'
import IndividualDecisionReport from '../features/game/IndividualDecisionReport'
import { decisionBadges, isIndividualMode } from '../features/game/individualDecisionModel'
import TurnMedia from '../features/game/TurnMedia'
import { useAutoResponse } from '../features/game/useAutoResponse'
import ControlBar from '../features/game/ControlBar'
import ChatDrawer from '../features/game/ChatDrawer'
import { chatUnread, micControl, othersCount, phaseCaption, skipLabel } from '../features/game/controlBarModel'
import { DICTATION_UNAVAILABLE } from '../features/game/dictationModel'
import { useDictation } from '../features/game/useDictation'
import { useTurnRecorder } from '../features/game/useTurnRecorder'
import RoomNameEditor from '../features/rooms/RoomNameEditor'
import './Game.css'

const CONTEXT_PHASES = ['reading', 'speaking', 'discussion']

function Game({ room, scenarios, error, rename, execute, onViewSummary, chat }: { room: RoomSnapshot; scenarios: Scenario[]; error: string; rename: (name: string) => Promise<void>; execute: (path: string, fields?: Record<string, unknown>) => Promise<void>; onViewSummary: () => void; chat: RoomChatHandle }) {
    const [notice, setNotice] = useState('')
    const [pending, setPending] = useState(false)
    const [text, setText] = useState('')
    const [dismissedOpening, setDismissedOpening] = useState('')
    const [proposal, setProposal] = useState('')
    const [ceo, setCeo] = useState('')
    const [speech, setSpeech] = useState({ phaseId: '', url: '' })
    const speechRef = useRef<HTMLAudioElement>(null)
    const [ownDecision, setOwnDecision] = useState<string | null>(null)
    const recorder = useTurnRecorder(room)
    // Dictation is owned here so the control bar's Mic can drive it; the decision panel attaches its text box as the sink.
    const dictationSink = useRef<((words: string) => void) | null>(null)
    const [dictationReady, setDictationReady] = useState(false)
    const dictation = useDictation((words) => dictationSink.current?.(words))
    const { stop: stopDictation } = dictation
    const attachDictation = useCallback<AttachDictation>((sink) => {
        dictationSink.current = sink
        setDictationReady(Boolean(sink))
        if (!sink) stopDictation()
    }, [stopDictation])
    const [chatOpen, setChatOpen] = useState(false)
    const [promptedPhase, setPromptedPhase] = useState('')
    const closeChat = useCallback(() => setChatOpen(false), [])
    // Unread counts other members' messages that arrived after the drawer was last open (history at entry counts as read).
    const [seenChat, setSeenChat] = useState<number | null>(null)
    const others = othersCount(chat.state.records, room.self_member_id)
    if (chat.state.loaded && (seenChat === null || (chatOpen && seenChat !== others))) setSeenChat(others)
    const unread = seenChat === null ? 0 : chatUnread(chat.state.records, room.self_member_id, seenChat)
    const game = room.game
    const auto = useAutoResponse(room, execute, (failure) => setNotice(errorMessage(failure)))
    // Keep the caller's last recorded decision so the ended report can show it even if that projection omits it.
    const seenDecision = game?.individual_decisions?.self?.text
    if (seenDecision && seenDecision !== ownDecision) setOwnDecision(seenDecision)
    useEffect(() => { const audio = speechRef.current; return () => { audio?.pause(); if (speech.url) URL.revokeObjectURL(speech.url) } }, [speech.url, game?.phase_id])
    // The decision prompt arrives in the chat: open the drawer once when the decision phase starts.
    if (game && room.phase === 'individual_decision' && promptedPhase !== game.phase_id) { setPromptedPhase(game.phase_id); setChatOpen(true) }
    if (!game) return null
    const scenario = scenarios.find((option) => option.scenario_id === game.scenario.scenario_id && option.version === game.scenario.version)
    const self = room.members.find((member) => member.member_id === room.self_member_id)
    const actions = game.allowed_actions ?? []
    const rounds = `rounds/${game.round_id}/`
    // Individual decision scenarios (Cedar T01) replace the board vote with one written decision per member.
    const individual = isIndividualMode(game)
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
    // Full stage phases keep their own on stage countdown, so the control bar omits its clock there.
    const fullStage = opening || experts
    // Individual decision games keep the call full width; the decision and the result appear as a centered card, never a side window.
    const card = individual && room.phase === 'ended'
    const sidePanel = !fullStage && !individual
    const layout = fullStage ? ' game-live-main--opening' : sidePanel ? ' game-live-main--focus' : card ? ' game-live-main--card' : ' game-live-main--call'
    // Only the caller's own ballot is known, so ballot badges are limited to the self tile.
    const badges: Record<string, TileBadge> = room.phase === 'individual_decision' ? decisionBadges(game.individual_decisions, room.self_member_id) : {}
    if (speaker && room.phase === 'speaking') badges[speaker.member_id] = { label: 'Speaking', tone: 'speaking' }
    if (room.phase === 'voting' && actions.includes('vote')) badges[room.self_member_id] = game.self_vote ? { label: 'Voted', tone: 'voted' } : { label: 'Decide now', tone: 'decide' }
    if (room.phase === 'tie_break' && actions.includes('tie_decision')) badges[room.self_member_id] = { label: 'Decide now', tone: 'decide' }

    const mic = micControl({
        phase: room.phase, phaseId: game.phase_id, ownTurn: recorder.ownTurn, recording: recorder.state,
        dictation: { supported: dictation.supported, listening: dictation.listening, blocked: dictation.note === DICTATION_UNAVAILABLE, ready: dictationReady },
    })
    function pressMic() {
        if (mic.action === 'start') void recorder.capture.start()
        else if (mic.action === 'stop' || mic.action === 'cancel') recorder.capture.stop()
        else if (mic.action === 'retry') void recorder.capture.retryUpload()
        else if (mic.action === 'dictate') dictation.start()
        else if (mic.action === 'stop-dictation') dictation.stop()
    }
    const node = game.current_node
    const nodeArticle = node && <article className="game-situation"><h3>{node.title}</h3><p>{node.situation}</p>{node.study_questions.map((question) => <p key={question} className="game-question">{question}</p>)}</article>
    const answering = self?.eligible_current_round && ((room.phase === 'speaking' && recorder.ownTurn) || room.phase === 'discussion')

    return <MotionConfig reducedMotion="user"><div className="game-call-screen game-live-screen">
        <header className="game-call-header">
            <div className="room-personal-controls"><button className="game-back-button" type="button" onClick={() => { window.location.hash = '/' }}><LobbyIcon name="back" /><span>Leave room</span></button><RoomNameEditor room={room} rename={rename} /></div>
            <div className="game-call-heading"><h1>Boardroom</h1><span>Room {room.room_code}</span></div>
            <div className="game-header-end"><button className="game-summary-button" type="button" onClick={onViewSummary}>Summary preview <span aria-hidden="true">↗</span></button><span className="game-player-count">{room.members.length} / {room.capacity}</span></div>
        </header>
        <main className={`game-call-main game-live-main${layout}`}>
            <AnimatePresence mode="wait" initial={false}>
                {opening ? <OpeningBriefing key="opening" room={room} onDismiss={() => setDismissedOpening(game.phase_id)} finishBriefing={actions.includes('finish_briefing') ? () => act(rounds + 'briefing/finish') : undefined} />
                    : experts ? <ExpertPanelStage key={`experts-${game.round_id}`} room={room} notice={error || notice} finishPanel={actions.includes('skip_phase') ? () => act(rounds + 'skip-phase') : undefined} />
                    : card ? <motion.section key={`card-${room.phase}`} className="game-briefing game-center-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
                        {(error || notice) && <p className="game-alert" role="alert">{error || notice}</p>}
                        {room.phase === 'ended' && <IndividualDecisionReport decisions={game.individual_decisions} ownText={game.individual_decisions?.self?.text ?? ownDecision} selfId={room.self_member_id} endingLabel={game.ending_label} />}
                        {room.phase === 'ended' && <TurnMedia room={room} recorder={recorder} />}
                    </motion.section>
                    : <motion.div key="call" className="game-stage-call" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: 'easeOut' }}>
                        <CallGrid members={roomMembers(room, {}, scenario)} badges={badges} />
                        {auto.status === 'playing' && <p className="game-subtitles" aria-live="polite"><strong>{self?.display_name ?? 'You'}:</strong> {auto.caption}</p>}
                        {!sidePanel && (error || notice) && <p className="game-alert game-alert--float" role="alert">{error || notice}</p>}
                    </motion.div>}
            </AnimatePresence>
            {sidePanel && <section className="game-briefing" aria-labelledby="briefing-title">
                <h2 id="briefing-title">{game.scenario.title}</h2>
                {(error || notice) && <p className="game-alert" role="alert">{error || notice}</p>}
                {individual && <IndividualDecisionPanel key={game.phase_id} room={room} pending={pending} act={act} notice={notice} dictation={dictation} attachDictation={attachDictation} />}
                {nodeArticle && (CONTEXT_PHASES.includes(room.phase) ? nodeArticle : room.phase !== 'ended' && <details className="game-situation-toggle"><summary>Situation: {node?.title}</summary>{nodeArticle}</details>)}
                {actions.includes('reassign_ceo') && <div className="game-actions"><label>Replacement CEO<select value={ceo} onChange={(event) => setCeo(event.target.value)}><option value="">Choose a participant</option>{room.members.filter((member) => member.connected && member.eligible_current_round && member.role_id !== 'ceo').map((member) => <option key={member.member_id} value={member.member_id}>{member.display_name}</option>)}</select></label><button disabled={pending || !ceo} onClick={() => void act(rounds + 'ceo-reassignment', { member_id: ceo })}>Assign CEO</button></div>}
                {!individual && <VotingPanel key={game.round_id} room={room} pending={pending} act={act} notice={notice} />}
                {answering && <form className="game-answer" onSubmit={(event) => { event.preventDefault(); void act('contributions', { kind: 'answer', source: 'typed', text }).then((ok) => { if (ok) setText('') }) }}><label>Your answer<textarea required maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} /></label><button disabled={pending || !text.trim()}>Save answer</button></form>}
                {actions.includes('proposal') && room.phase !== 'voting' && <form onSubmit={(event) => { event.preventDefault(); void act(rounds + 'proposal', { text: proposal }) }}><label>Custom action<textarea required value={proposal} onChange={(event) => setProposal(event.target.value)} /></label><button disabled={pending || !proposal.trim()}>Save custom action</button>{game.proposals?.some((item) => item.member_id === room.self_member_id) && <button type="button" disabled={pending} onClick={() => void act(rounds + 'proposal', { text: '' })}>Withdraw action</button>}</form>}
                {game.resolution && !['resolving', 'resolution_failed', 'decision', 'result'].includes(room.phase) && <p role="status">Custom action evaluation: {game.resolution.status}. {game.resolution.error}</p>}
                {actions.includes('retry_resolution') && <button disabled={pending} onClick={() => void act(rounds + 'resolution/retry')}>Retry custom evaluation</button>}
                {!individual && game.last_result && <article className="game-result"><h3>{room.phase === 'ended' ? 'Final consequence' : 'What happened'}</h3><p>{game.last_result.text}</p>{game.narration && <button type="button" onClick={() => void narrate()}>Play consequence</button>}{speech.url && speech.phaseId === game.phase_id && <audio ref={speechRef} controls src={speech.url} onPlaying={() => { if (game.narration) void roomApi.narrationEvent(room.room_id, game.narration.narration_id, 'started') }} onEnded={() => { if (game.narration) void roomApi.narrationEvent(room.room_id, game.narration.narration_id, 'completed') }} />}</article>}
                {room.phase === 'ended' && individual && <IndividualDecisionReport decisions={game.individual_decisions} ownText={game.individual_decisions?.self?.text ?? ownDecision} selfId={room.self_member_id} endingLabel={game.ending_label} />}
                {room.phase === 'ended' && !individual && <section><h3>Final report</h3><p>Ending: {game.ending_label?.replaceAll('_', ' ')}</p>{game.history?.map((record) => <article key={record.decision_id}><h4>Round {record.round_number}: {record.selected_option_label ?? 'No decision'}</h4><p>{record.text}</p></article>)}</section>}
                <TurnMedia room={room} recorder={recorder} />
                {game.public_documents.length > 0 && <details className="game-documents"><summary>Public scenario documents</summary>{game.public_documents.map((document) => <article key={document.id} className="game-public-document"><h3>{document.id.replaceAll('_', ' ')}</h3><div>{document.text}</div></article>)}</details>}
            </section>}
        </main>
        <ControlBar
            caption={phaseCaption(room.phase, speaker ? { name: speaker.display_name, self: speaker.member_id === room.self_member_id } : null)}
            round={`Round ${game.round_number}`} phaseId={game.phase_id} deadline={game.phase_deadline} serverTime={game.server_time}
            showCountdown={!fullStage} pending={pending}
            mic={{ ...mic, onClick: pressMic }}
            chat={{ open: chatOpen, unread, onToggle: () => setChatOpen((open) => !open) }}
            autoResponse={auto.status === 'unavailable' ? undefined : {
                label: auto.status === 'playing' ? 'Stop response' : auto.status === 'saving' ? 'Saving…' : auto.status === 'done' ? 'Response sent' : 'Auto response',
                live: auto.status === 'playing', disabled: pending || auto.status === 'saving' || auto.status === 'done',
                onClick: () => { if (auto.status === 'playing') auto.stop(); else auto.start() },
            }}
            finishTurn={actions.includes('finish_speaking') ? () => void act(rounds + 'speaker/finish') : undefined}
            skip={actions.includes('skip_phase') ? { label: skipLabel(room.phase), onClick: () => void act(rounds + 'skip-phase') } : undefined}
            skipSpeaker={actions.includes('skip_speaker') ? () => void act(rounds + 'speaker/skip', { reason: 'Skipped by the host' }) : undefined}
            end={actions.includes('end') ? () => void act('end') : undefined}
        />
        <ChatDrawer room={room} scenarios={scenarios} chat={chat} open={chatOpen} onClose={closeChat}
            pinned={individual && room.phase === 'individual_decision' ? <div className="game-briefing chat-decision"><p className="chat-decision-from">Facilitator · Round 1</p><IndividualDecisionPanel key={game.phase_id} room={room} pending={pending} act={act} notice={notice} dictation={dictation} attachDictation={attachDictation} /></div> : undefined} />
    </div></MotionConfig>
}
export default Game
