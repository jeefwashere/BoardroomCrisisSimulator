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
import { DecisionStatusPanel } from '../features/game/IndividualDecisionPanel'
import { useDecisionAutoResponse } from '../features/game/useDecisionAutoResponse'
import type { AttachDictation } from '../features/game/IndividualDecisionPanel'
import IndividualDecisionReport from '../features/game/IndividualDecisionReport'
import { decisionBadges, endingTitle, isIndividualMode } from '../features/game/individualDecisionModel'
import TurnMedia from '../features/game/TurnMedia'
import { useAutoResponse } from '../features/game/useAutoResponse'
import PrivateSessionStage from '../features/game/PrivateSessionStage'
import PrivateSessionReport from '../features/game/PrivateSessionReport'
import { usePrivateSession } from '../features/game/usePrivateSession'
import { usePrivateAutoResponse } from '../features/game/usePrivateAutoResponse'
import { ownPrivateRound } from '../features/game/privateSessionModel'
import ControlBar from '../features/game/ControlBar'
import ChatDrawer from '../features/game/ChatDrawer'
import { chatUnread, micControl, offersReport, othersCount, phaseCaption, skipLabel } from '../features/game/controlBarModel'
import { DICTATION_UNAVAILABLE } from '../features/game/dictationModel'
import { useDictation } from '../features/game/useDictation'
import { useTurnRecorder } from '../features/game/useTurnRecorder'
import RoomNameEditor from '../features/rooms/RoomNameEditor'
import TranscriptPanel from '../features/game/TranscriptPanel'
import ReportDialog from '../features/game/ReportDialog'
import { useWindowMute } from '../features/game/windowMute'
import { useSharedClip } from '../features/game/useSharedClip'
import { useMeetingDocuments } from '../features/facilitation/useMeetingDocuments'
import { useSpokenLine, useTranscript } from '../features/game/useTranscript'
import { CAPTIONS_STORAGE_KEY, captionsPreference, speechDurationMs, turnEntry } from '../features/game/transcriptModel'
import { clipForTurn } from '../features/game/savedClips'
import { playerAvatarColor, playerRoleLabel } from '../features/game/playerPresentation'
import Boardroom3D from '../features/boardroom3d/Boardroom3D'
import { AgentPresenceContext } from '../features/boardroom3d/agentPresence'
import { STAGE_STORAGE_KEY, boardroomView, offersStageSwitch, stagePreference } from '../features/boardroom3d/boardroomModel'
import type { StageAgent } from '../features/boardroom3d/boardroomModel'
import { DEMO_STORAGE_KEY, readStoredDemo } from '../features/demo/demoModel'
import { seatFromSearch } from '../services/tabSession'
import './Game.css'
import './GameTheme.css'

const CONTEXT_PHASES = ['reading', 'speaking', 'discussion']

function tabStorage(): Storage | null {
    try { return window.sessionStorage } catch { return null }
}

function readCaptions(): boolean {
    try { return captionsPreference(tabStorage()?.getItem(CAPTIONS_STORAGE_KEY)) } catch { return true }
}

function storeCaptions(on: boolean) {
    try { tabStorage()?.setItem(CAPTIONS_STORAGE_KEY, on ? '1' : '0') } catch { /* The choice lasts for this view only. */ }
}

/** The 3D boardroom or the call tiles: this tab's last choice, else `?view=3d`. Controls, transcript and chat stay the same. */
function readView3d(): boolean {
    if (typeof window === 'undefined') return false
    try { return stagePreference(tabStorage()?.getItem(STAGE_STORAGE_KEY) ?? null, window.location.search) === '3d' } catch { return false }
}

const TRANSCRIPT_MINIMIZED_KEY = 'boardroom.transcriptMinimized'

function readTranscriptMinimized(): boolean {
    try { return tabStorage()?.getItem(TRANSCRIPT_MINIMIZED_KEY) === '1' } catch { return false }
}

function storeTranscriptMinimized(on: boolean) {
    try { tabStorage()?.setItem(TRANSCRIPT_MINIMIZED_KEY, on ? '1' : '0') } catch { /* The choice lasts for this view only. */ }
}

function storeView3d(on: boolean) {
    try { tabStorage()?.setItem(STAGE_STORAGE_KEY, on ? '3d' : 'call') } catch { /* The choice lasts for this view only. */ }
}

/** Alex's frame in the solo demo: Morgan's and Sam's clips play from the parent page, so this view captions them. */
function drivesSoloBots(): boolean {
    if (typeof window === 'undefined' || seatFromSearch(window.location.search) !== 'alex') return false
    try { return readStoredDemo(tabStorage()?.getItem(DEMO_STORAGE_KEY) ?? null)?.mode === 'solo' } catch { return false }
}

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
    // Open floor: after Mic takes the floor, start recording as soon as the room shows the caller holding it.
    const claimMic = useRef(false)
    useEffect(() => {
        if (claimMic.current && recorder.ownTurn) { claimMic.current = false; void recorder.capture.start() }
        else if (claimMic.current && room.phase !== 'speaking') claimMic.current = false
    })
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
    // Report: the meeting's incident report PDF, opened from the control bar.
    const report = useMeetingDocuments(room.room_id).featured
    const [reportOpen, setReportOpen] = useState(false)
    const closeReport = useCallback(() => setReportOpen(false), [])
    const [muted, toggleMuted] = useWindowMute()
    // CC: the live transcript panel, on by default and remembered for this tab. Chat replaces it while open.
    const [captions, setCaptions] = useState(readCaptions)
    const toggleCaptions = useCallback(() => setCaptions((on) => { storeCaptions(!on); return !on }), [])
    const hideCaptions = useCallback(() => { storeCaptions(false); setCaptions(false) }, [])
    const transcriptOpen = captions && !chatOpen
    // The transcript card can fold to its header bar; remembered for this tab.
    const [transcriptMinimized, setTranscriptMinimized] = useState(readTranscriptMinimized)
    const toggleTranscriptMinimized = useCallback(() => setTranscriptMinimized((on) => { storeTranscriptMinimized(!on); return !on }), [])
    const [dock, setDock] = useState<HTMLDivElement | null>(null)
    const { entries: transcriptEntries, writer: transcript } = useTranscript(`${room.room_id}:${room.game?.started_at ?? ''}`)
    const [soloBots] = useState(drivesSoloBots)
    const [view3d, setView3d] = useState(readView3d)
    const toggleView3d = useCallback(() => setView3d((on) => { storeView3d(!on); return !on }), [])
    // Once opened, the 3D scene stays loaded (paused while hidden) so switching back and forth is instant.
    const [mounted3d, setMounted3d] = useState(false)
    // The AI voice the current stage is playing (reported by the opening, expert and private stages) lights the 3D hub.
    const [stageAgent, setStageAgent] = useState<StageAgent | null>(null)
    // Unread counts other members' messages that arrived after the drawer was last open (history at entry counts as read).
    const [seenChat, setSeenChat] = useState<number | null>(null)
    const others = othersCount(chat.state.records, room.self_member_id)
    if (chat.state.loaded && (seenChat === null || (chatOpen && seenChat !== others))) setSeenChat(others)
    const unread = seenChat === null ? 0 : chatUnread(chat.state.records, room.self_member_id, seenChat)
    const game = room.game
    const auto = useAutoResponse(room, execute, (failure) => setNotice(errorMessage(failure)))
    // Rounds 2 and 3: the caller's private branch, read during the private sessions and once more for the ended record.
    const privatePhase = room.phase === 'private_session'
    const privateRecord = privatePhase || (room.phase === 'ended' && Boolean(game?.private_rounds))
    const privateSession = usePrivateSession(room.room_id, privateRecord, room.phase)
    // Round 1 individual decision: AI reply writes and speaks the caller's decision (heard only here), then saves it.
    const decisionAuto = useDecisionAutoResponse(room, (text) => act(`rounds/${room.game?.round_id}/decision`, { text }), (failure) => setNotice(errorMessage(failure)))
    const privateAuto = usePrivateAutoResponse(room.room_id, privatePhase ? privateSession.session : null, privateSession.sending, privateSession.answer, (failure) => setNotice(errorMessage(failure)))
    // Keep the caller's last recorded decision so the ended report can show it even if that projection omits it.
    const seenDecision = game?.individual_decisions?.self?.text
    if (seenDecision && seenDecision !== ownDecision) setOwnDecision(seenDecision)
    useEffect(() => { const audio = speechRef.current; return () => { audio?.pause(); if (speech.url) URL.revokeObjectURL(speech.url) } }, [speech.url, game?.phase_id])
    const scenario = game ? scenarios.find((option) => option.scenario_id === game.scenario.scenario_id && option.version === game.scenario.version) : undefined
    const members = game ? roomMembers(room, {}, scenario) : []
    const selfMember = members.find((member) => member.id === room.self_member_id)
    const selfName = selfMember?.name ?? 'You'
    const selfRole = selfMember ? selfMember.roleLabel ?? playerRoleLabel(selfMember.role) : 'Board member'
    // Speaking turns: your Auto response clip is captioned in step with its audio; it is never shown on the call.
    const selfLine = auto.playback && auto.turn ? { entry: turnEntry(auto.turn, { name: selfName, role: selfRole }, auto.caption, true), durationMs: auto.playback.durationMs } : null
    useSpokenLine(transcript, selfLine)
    useEffect(() => {
        // A clip the browser refused to play is still committed: its caption goes to the transcript in full.
        if (auto.turn && auto.caption && (auto.status === 'saving' || auto.status === 'done')) transcript.upsert(turnEntry(auto.turn, { name: selfName, role: selfRole }, auto.caption, true))
    }, [auto.turn, auto.caption, auto.status, selfName, selfRole, transcript])
    // Solo demo: a bot's turn plays its assigned clip from the parent page, so its caption is added here for the turn.
    const activeSpeakerId = room.phase === 'speaking' ? game?.active_speaker_id ?? null : null
    const botMember = soloBots && activeSpeakerId && activeSpeakerId !== room.self_member_id ? members.find((member) => member.id === activeSpeakerId) : undefined
    const botClip = botMember && game ? clipForTurn(game, auto.catalog, botMember.id) : null
    const botLine = botMember && botClip && game ? {
        entry: turnEntry(`${game.phase_id}:${botMember.id}`, { name: botMember.name, role: botMember.roleLabel ?? playerRoleLabel(botMember.role) }, botClip.text, false),
        durationMs: speechDurationMs(botClip.duration_seconds, botClip.text),
    } : null
    useSpokenLine(transcript, botLine)
    // Untimed turns: another player's saved clip plays here too, captioned in step like your own.
    const shared = useSharedClip(room, auto.catalog)
    const sharedMember = shared ? members.find((member) => member.id === shared.speakerId) : undefined
    const sharedLine = shared && sharedMember && shared.text ? {
        entry: turnEntry(shared.turn, { name: sharedMember.name, role: sharedMember.roleLabel ?? playerRoleLabel(sharedMember.role) }, shared.text, false),
        durationMs: shared.remainingMs,
    } : null
    useSpokenLine(transcript, sharedLine)
    // The decision prompt arrives in the chat: open the drawer once when the decision phase starts.
    if (game && room.phase === 'individual_decision' && promptedPhase !== game.phase_id) { setPromptedPhase(game.phase_id); setChatOpen(true) }
    // Private sessions are one to one with the coach: close the room chat once when they begin.
    if (game && room.phase === 'private_session' && promptedPhase !== game.phase_id) { setPromptedPhase(game.phase_id); setChatOpen(false) }
    if (!game) return null
    const self = room.members.find((member) => member.member_id === room.self_member_id)
    const actions = game.allowed_actions ?? []
    // Open floor: whoever gave up the floor last waits until someone else has spoken.
    const spokeLast = room.phase === 'speaking' && Boolean(game.floor_open) && game.last_speaker_id === room.self_member_id
    const rounds = `rounds/${game.round_id}/`
    // Individual decision scenarios (Cedar T01) replace the board vote with one written decision per member.
    const individual = isIndividualMode(game)
    // Games with private rounds also keep the call full width and end on the centered card.
    const centered = individual || Boolean(game.private_rounds)
    const ownRound = privatePhase ? ownPrivateRound(privateSession.session, game.private_progress, room.self_member_id) : null
    const reportAvailable = offersReport(room.phase)
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
    // Rounds 2 and 3 take the full stage: only the member and their crisis coach, no call grid.
    const privateStage = !opening && privatePhase
    // Full stage phases keep their own on stage countdown, so the control bar omits its clock there.
    const fullStage = opening || experts || privateStage
    // Individual decision games keep the call full width; the decision and the result appear as a centered card, never a side window.
    const card = centered && room.phase === 'ended'
    const sidePanel = !fullStage && !centered
    const layout = fullStage ? ' game-live-main--opening' : sidePanel ? ' game-live-main--focus' : card ? ' game-live-main--card' : ' game-live-main--call'
    // Only the caller's own ballot is known, so ballot badges are limited to the self tile.
    const badges: Record<string, TileBadge> = room.phase === 'individual_decision' ? decisionBadges(game.individual_decisions, room.self_member_id) : {}
    if (speaker && room.phase === 'speaking') badges[speaker.member_id] = { label: 'Speaking', tone: 'speaking' }
    if (room.phase === 'voting' && actions.includes('vote')) badges[room.self_member_id] = game.self_vote ? { label: 'Voted', tone: 'voted' } : { label: 'Decide now', tone: 'decide' }
    if (room.phase === 'tie_break' && actions.includes('tie_decision')) badges[room.self_member_id] = { label: 'Decide now', tone: 'decide' }
    // Who animates on the call: the member holding the floor (your own tile only while your clip plays or your mic is live).
    const talking = new Set<string>()
    if (speaker && room.phase === 'speaking') {
        if (speaker.member_id !== room.self_member_id) talking.add(speaker.member_id)
        else if (auto.status === 'playing' || recorder.state.status === 'recording') talking.add(speaker.member_id)
    }
    if (dictation.listening) talking.add(room.self_member_id)
    // In a private session your saved answer is spoken by your own character.
    if (privatePhase && privateAuto.status === 'playing') talking.add(room.self_member_id)
    // Round 1: your decision, spoken in your role voice by AI reply, is said by your own character too.
    if (room.phase === 'individual_decision' && decisionAuto.status === 'playing') talking.add(room.self_member_id)
    const stageSwitch = offersStageSwitch(members.length)
    const show3d = view3d && stageSwitch
    if (show3d && !mounted3d) setMounted3d(true)
    const board = mounted3d && stageSwitch ? boardroomView({
        phase: room.phase, selfId: room.self_member_id, eligibleIds: game.eligible_member_ids, activeSpeakerId,
        speakerIndex: game.speaker_index ?? null, speakerCount: game.speaker_order?.length ?? 0, scenarioTitle: game.scenario.title,
    }, members.map((member) => ({ id: member.id, name: member.name, role: member.roleLabel ?? playerRoleLabel(member.role), color: playerAvatarColor(member.id), connected: member.connected ?? true })),
    talking, stageAgent) : null

    const mic = micControl({
        phase: room.phase, phaseId: game.phase_id, ownTurn: recorder.ownTurn, canClaim: actions.includes('take_floor'), spokeLast, recording: recorder.state,
        dictation: { supported: dictation.supported, listening: dictation.listening, blocked: dictation.note === DICTATION_UNAVAILABLE, ready: dictationReady },
    })
    function pressMic() {
        // Open floor: take the floor first; recording starts once the room shows it is yours (effect below).
        if (mic.action === 'claim') void act(rounds + 'speaker/claim').then((ok) => { claimMic.current = ok })
        else if (mic.action === 'start') void recorder.capture.start()
        else if (mic.action === 'stop' || mic.action === 'cancel') recorder.capture.stop()
        else if (mic.action === 'retry') void recorder.capture.retryUpload()
        else if (mic.action === 'dictate') dictation.start()
        else if (mic.action === 'stop-dictation') dictation.stop()
    }
    // AI reply: a Vertex written, ElevenLabs spoken reply for the caller's speaking turn, or for the current private question.
    // In a private session the button stays (disabled) between questions so the bar does not jump.
    const decisionPhase = room.phase === 'individual_decision'
    const activeAuto = privatePhase ? privateAuto : decisionPhase ? decisionAuto : auto
    const privateAnswering = privatePhase && (privateSession.session?.stage === 'coaching' || privateSession.session?.stage === 'assessment')
    const privateQuiz = privatePhase && privateSession.session?.stage === 'assessment' && Boolean(privateSession.session.quiz)
    const autoControl = activeAuto.status === 'unavailable'
        ? privateAnswering ? { label: 'AI reply', live: false, disabled: true, title: privateQuiz ? 'Round 3 is multiple choice: pick your answer on the question card.' : 'Available when your coach asks you a question.', onClick: () => undefined }
            : spokeLast ? { label: 'AI reply', live: false, disabled: true, title: 'You just had the floor. Someone else speaks next, then you can take it again.', onClick: () => undefined } : undefined
        : {
            label: activeAuto.status === 'playing' ? 'Stop reply' : activeAuto.status === 'writing' ? 'Writing…' : activeAuto.status === 'saving' ? 'Saving…' : activeAuto.status === 'done' ? 'Reply sent' : 'AI reply',
            live: activeAuto.status === 'playing', disabled: pending || (privatePhase && privateSession.sending) || activeAuto.status === 'writing' || activeAuto.status === 'saving' || activeAuto.status === 'done',
            title: privatePhase ? 'Let the AI write and speak an answer to your coach in your voice, then submit it'
                : decisionPhase ? (decisionAuto.saved ? 'Let the AI write and speak a new decision for you; it replaces the one recorded' : 'Let the AI write your decision for your role and speak it in your voice (only you hear it), then save it') : 'Let the AI write and speak your turn in your voice (Vertex AI and ElevenLabs), then add it to the transcript',
            onClick: () => { if (activeAuto.status === 'playing') activeAuto.stop(); else activeAuto.start() },
        }
    const node = game.current_node
    const nodeArticle = node && <article className="game-situation"><h3>{node.title}</h3><p>{node.situation}</p>{node.study_questions.map((question) => <p key={question} className="game-question">{question}</p>)}</article>
    const answering = self?.eligible_current_round && ((room.phase === 'speaking' && recorder.ownTurn) || room.phase === 'discussion')

    return <AgentPresenceContext.Provider value={setStageAgent}><MotionConfig reducedMotion="user"><div className={`game-call-screen game-live-screen${chatOpen ? ' has-side-panel' : ''}${transcriptOpen ? ' has-transcript' : ''}`}>
        <header className="game-call-header">
            <div className="room-personal-controls"><button className="game-back-button" type="button" onClick={() => { window.location.hash = '/' }}><LobbyIcon name="back" /><span>Leave room</span></button><RoomNameEditor room={room} rename={rename} /></div>
            <div className="game-call-heading"><h1>Boardroom</h1><span>Room {room.room_code}</span></div>
            <div className="game-header-end"><button className="game-summary-button" type="button" onClick={onViewSummary}>Summary preview <span aria-hidden="true">↗</span></button><span className="game-player-count">{room.members.length} / {room.capacity}</span></div>
        </header>
        <main className={`game-call-main game-live-main${layout}${show3d ? ' game-live-main--3d' : ''}`}>
            {board && <Boardroom3D active={show3d} view={board} clock={{ deadline: game.phase_deadline ?? null, serverTime: game.server_time ?? null }} />}
            <AnimatePresence mode="wait" initial={false}>
                {opening ? <OpeningBriefing key="opening" room={room} members={members} transcript={transcript} onDismiss={() => setDismissedOpening(game.phase_id)} finishBriefing={actions.includes('finish_briefing') ? () => act(rounds + 'briefing/finish') : undefined} />
                    : experts ? <ExpertPanelStage key={`experts-${game.round_id}`} room={room} members={members} transcript={transcript} notice={error || notice} finishPanel={actions.includes('skip_phase') ? () => act(rounds + 'skip-phase') : undefined} />
                    : privateStage ? <PrivateSessionStage key="private" room={room} handle={privateSession}
                        auto={{ playing: privateAuto.status === 'playing', caption: privateAuto.caption, key: privateAuto.key, playback: privateAuto.playback }}
                        selfName={selfName} selfRole={selfRole} dictation={dictation} attachDictation={attachDictation} notice={error || notice}
                        transcript={transcript} dock={transcriptOpen ? dock : null} />
                    : card ? <motion.section key={`card-${room.phase}`} className="game-briefing game-center-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
                        {(error || notice) && <p className="game-alert" role="alert">{error || notice}</p>}
                        {room.phase === 'ended' && game.private_rounds && <h2 className="private-ended-title">{game.ending_title || endingTitle(game.ending_label)}</h2>}
                        {room.phase === 'ended' && <IndividualDecisionReport decisions={game.individual_decisions} ownText={game.individual_decisions?.self?.text ?? ownDecision ?? privateSession.session?.decision_text ?? null} selfId={room.self_member_id} endingLabel={game.ending_label}
                            heading={game.private_rounds ? 'Your individual decision' : game.ending_title ?? undefined} />}
                        {room.phase === 'ended' && game.private_rounds && <PrivateSessionReport session={privateSession.session} unavailable={privateSession.unavailable} notStarted={privateSession.notStarted}
                            notEligible={privateSession.notEligible} retry={privateSession.retry} sending={privateSession.sending} />}
                        {room.phase === 'ended' && <TurnMedia room={room} recorder={recorder} />}
                    </motion.section>
                    : <motion.div key="call" className="game-stage-call" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: 'easeOut' }}>
                        {!show3d && <CallGrid members={members} badges={badges} talking={talking} />}
                        {!sidePanel && (error || notice) && <p className="game-alert game-alert--float" role="alert">{error || notice}</p>}
                    </motion.div>}
            </AnimatePresence>
            {sidePanel && <section className="game-briefing" aria-labelledby="briefing-title">
                <h2 id="briefing-title">{game.scenario.title}</h2>
                {(error || notice) && <p className="game-alert" role="alert">{error || notice}</p>}
                {individual && <DecisionStatusPanel room={room} speaking={decisionAuto.status === 'playing'} saving={decisionAuto.status === 'saving'} caption={decisionAuto.caption} />}
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
            caption={phaseCaption(room.phase, speaker ? { name: speaker.display_name, self: speaker.member_id === room.self_member_id } : null, ownRound, Boolean(game.floor_open), spokeLast)}
            round={`Round ${ownRound ?? game.round_number}`} phaseId={game.phase_id} deadline={game.phase_deadline} serverTime={game.server_time}
            showCountdown={!fullStage} pending={pending}
            mic={{ ...mic, onClick: pressMic }}
            chat={{ open: chatOpen, unread, onToggle: () => setChatOpen((open) => !open) }}
            captions={{ on: captions, onToggle: toggleCaptions }}
            stage={stageSwitch ? { threeD: show3d, onToggle: toggleView3d } : undefined}
            mute={{ on: muted, onToggle: toggleMuted }}
            report={report && reportAvailable ? { open: reportOpen, onToggle: () => setReportOpen((open) => !open) } : undefined}
            autoResponse={autoControl}
            finishTurn={actions.includes('finish_speaking') ? () => void act(rounds + 'speaker/finish') : undefined}
            endMeeting={actions.includes('end_meeting') ? () => void act(rounds + 'meeting/end') : undefined}
            skip={actions.includes('skip_phase') ? { label: skipLabel(room.phase), onClick: () => void act(rounds + 'skip-phase') } : undefined}
            skipSpeaker={actions.includes('skip_speaker') ? () => void act(rounds + 'speaker/skip', { reason: 'Skipped by the host' }) : undefined}
            end={actions.includes('end') ? () => void act('end') : undefined}
        />
        <ReportDialog report={report} open={reportOpen && reportAvailable} onClose={closeReport} />
        <TranscriptPanel entries={transcriptEntries} open={transcriptOpen} onClose={hideCaptions} dockRef={setDock} minimized={transcriptMinimized} onToggleMinimized={toggleTranscriptMinimized} />
        <ChatDrawer room={room} scenarios={scenarios} chat={chat} open={chatOpen} onClose={closeChat}
            pinned={individual && room.phase === 'individual_decision' ? <div className="game-briefing chat-decision"><p className="chat-decision-from">Facilitator · Round 1</p><DecisionStatusPanel room={room} speaking={decisionAuto.status === 'playing'} saving={decisionAuto.status === 'saving'} caption={decisionAuto.caption} /></div> : undefined}
            decision={individual && room.phase === 'individual_decision' && actions.includes('submit_decision') ? { submit: (text) => act(`rounds/${game.round_id}/decision`, { text }), pending, recorded: game.individual_decisions?.self?.text ?? null, attachDictation } : undefined} />
    </div></MotionConfig></AgentPresenceContext.Provider>
}
export default Game
