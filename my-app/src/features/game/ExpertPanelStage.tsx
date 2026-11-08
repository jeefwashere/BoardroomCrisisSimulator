import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { RoomSnapshot } from '../../services/rooms'
import type { Adviser, ExpertPanel, ExpertTake } from '../../services/facilitation'
import { facilitationApi, facilitationErrorMessage } from '../facilitation/facilitationClient'
import { pollRoom } from '../rooms/roomState'
import { seatFromSearch } from '../../services/tabSession'
import Countdown from './Countdown'
import {
    EXPERT_ORDER, EXPERT_STATUS_LABELS, PANEL_EXPERT_ORDER, activeExpertIndex, expertAccent, expertCardStatus, expertInitials,
    expertPersona, normalizeExperts, panelForRound, panelSettled, panelSourceLabel,
} from './expertPanelModel'

const POLL_MS = 1500
// Roughly the pace of spoken ElevenLabs speech, so the text keeps up with the voice and silent frames stay close to the host.
const CHARS_PER_SECOND = 15
// Pause after a silent take finishes typing, before the next expert starts.
const HOLD_MS = 1600
const SPEECH_RETRIES = 12
// In the one window demo only the first seat (the host) plays sound, so three frames never talk over each other.
const SEAT = typeof window === 'undefined' ? null : seatFromSearch(window.location.search)
const PLAYS_VOICE = SEAT === null || SEAT === 'alex'

type Voice = { state: 'loading' } | { state: 'ready'; url: string } | { state: 'unavailable'; message: string }

function useExpertPanel(roomId: string, roundId: string) {
    const [panel, setPanel] = useState<ExpertPanel | null>(null)
    const [advisers, setAdvisers] = useState<Adviser[]>([])
    const [error, setError] = useState('')
    useEffect(() => {
        const stop: () => void = pollRoom((signal) => facilitationApi.state(roomId, signal), (state) => {
            const current = panelForRound(state.expert_panel, roundId)
            setPanel(current)
            setAdvisers(state.advisers ?? [])
            setError('')
            if (panelSettled(current)) stop()
        }, (failure) => setError(facilitationErrorMessage(failure, 'The expert panel is unavailable right now.')), POLL_MS)
        return stop
    }, [roomId, roundId])
    return { panel, advisers, error }
}

/** Prepares every ready take's speech as soon as it exists, so the next expert starts without a gap. */
function useExpertVoices(roomId: string, experts: readonly ExpertTake[], enabled: boolean) {
    const [voices, setVoices] = useState<Record<string, Voice>>({})
    const requested = useRef(new Set<string>())
    const urls = useRef<string[]>([])
    const alive = useRef(true)
    useEffect(() => {
        alive.current = true
        const created = urls.current
        return () => { alive.current = false; for (const url of created) URL.revokeObjectURL(url); created.length = 0 }
    }, [])
    useEffect(() => {
        if (!enabled) return
        const settle = (speechId: string, voice: Voice) => { if (alive.current) setVoices((current) => ({ ...current, [speechId]: voice })) }
        async function load(speechId: string, attempt = 0): Promise<void> {
            try {
                const prepared = await facilitationApi.prepareSpeech(roomId, speechId)
                if (!alive.current) return
                if (prepared.status === 'pending') {
                    if (attempt < SPEECH_RETRIES) { await new Promise((resolve) => setTimeout(resolve, 1500)); return load(speechId, attempt + 1) }
                    settle(speechId, { state: 'unavailable', message: 'The voice took too long to prepare. The take stays readable.' }); return
                }
                if (prepared.status === 'disabled') { settle(speechId, { state: 'unavailable', message: 'Spoken takes are turned off for this session.' }); return }
                if (prepared.status !== 'ready') { settle(speechId, { state: 'unavailable', message: prepared.error || 'The voice could not be prepared. The take stays readable.' }); return }
                const blob = await facilitationApi.speechAudio(roomId, speechId)
                if (!alive.current) return
                const url = URL.createObjectURL(blob)
                urls.current.push(url)
                settle(speechId, { state: 'ready', url })
            } catch (failure) {
                settle(speechId, { state: 'unavailable', message: facilitationErrorMessage(failure, 'The voice is unavailable. The take stays readable.') })
            }
        }
        for (const take of experts) {
            const speechId = take.status === 'ready' ? take.speech_id : null
            if (!speechId || requested.current.has(speechId)) continue
            requested.current.add(speechId)
            void load(speechId)
        }
    }, [roomId, experts, enabled])
    return useCallback((take: ExpertTake): Voice | null => {
        if (!enabled || take.status !== 'ready' || !take.speech_id) return null
        return voices[take.speech_id] ?? { state: 'loading' }
    }, [enabled, voices])
}

function Typewriter({ text, onDone }: { text: string; onDone: () => void }) {
    const reduceMotion = useReducedMotion()
    const [count, setCount] = useState(0)
    const complete = reduceMotion || count >= text.length
    useEffect(() => {
        if (complete) { onDone(); return }
        const timer = setInterval(() => setCount((current) => Math.min(text.length, current + 1)), 1000 / CHARS_PER_SECOND)
        return () => clearInterval(timer)
    }, [complete, text, onDone])
    return <div className="opening-text expert-text">
        <p className="game-visually-hidden">{text}</p>
        <p aria-hidden="true">{complete ? text : text.slice(0, count)}{!complete && <span className="opening-caret" />}</p>
    </div>
}

function Orb() {
    return <div className="opening-orb expert-orb" aria-hidden="true">
        <span className="opening-ring" />
        <span className="opening-ring opening-ring--late" />
        <span className="opening-core"><span className="opening-wave" /><span className="opening-wave" /><span className="opening-wave" /><span className="opening-wave" /></span>
    </div>
}

type Props = {
    room: RoomSnapshot
    /** Host only: ends the panel for the whole room and opens voting (or individual decisions). */
    finishPanel?: () => Promise<boolean>
    /** Room command error to surface while the briefing column is hidden. */
    notice?: string
}

export default function ExpertPanelStage({ room, finishPanel, notice }: Props) {
    const game = room.game
    const roundId = game?.round_id ?? ''
    const { panel, advisers, error } = useExpertPanel(room.room_id, roundId)
    // Individual decision scenarios use the security, operations and governance panel; the vote wording changes with it.
    const individual = game?.decision_mode === 'individual'
    const experts = useMemo(() => normalizeExperts(panel, individual ? PANEL_EXPERT_ORDER : EXPERT_ORDER), [panel, individual])
    const voiceFor = useExpertVoices(room.room_id, experts, PLAYS_VOICE)
    const [step, setStep] = useState(0)
    const [typedIndex, setTypedIndex] = useState(-1)
    const [startedIndex, setStartedIndex] = useState(-1)
    const [playing, setPlaying] = useState(false)
    const [blocked, setBlocked] = useState(false)
    const [finishFailed, setFinishFailed] = useState(false)
    const [brokenSpeech, setBrokenSpeech] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement>(null)
    const finishRequested = useRef(false)

    const active = panel ? activeExpertIndex(experts, step) : 0
    const activeTake = active >= 0 ? experts[active] : null
    const activeVoice = activeTake ? voiceFor(activeTake) : null
    // A take is voice driven when this frame plays sound and the voice has not given up; the audio's end moves the floor on.
    const voiceDriven = activeVoice !== null && activeVoice.state !== 'unavailable' && brokenSpeech !== activeTake?.speech_id
    const activeUrl = voiceDriven && activeVoice?.state === 'ready' ? activeVoice.url : null
    const complete = panel !== null && active === -1

    const markTyped = useCallback(() => setTypedIndex(active), [active])

    // Silent takes (other frames, or no voice available) advance after their text has typed out.
    useEffect(() => {
        if (active < 0 || activeTake?.status !== 'ready' || voiceDriven || typedIndex !== active) return
        const timer = setTimeout(() => setStep(active + 1), HOLD_MS)
        return () => clearTimeout(timer)
    }, [active, activeTake?.status, voiceDriven, typedIndex])

    useEffect(() => {
        const element = audioRef.current
        if (!element || !activeUrl) return
        element.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
    }, [activeUrl])

    // Once the last expert finishes on the voice frame, the host opens voting for everyone.
    useEffect(() => {
        if (!complete || !PLAYS_VOICE || !finishPanel || finishRequested.current) return
        finishRequested.current = true
        void finishPanel().then((ok) => { if (!ok) setFinishFailed(true) })
    }, [complete, finishPanel])

    if (!game) return null

    function endTurn(index: number) {
        setPlaying(false)
        setStep((current) => Math.max(current, index + 1))
    }

    function skipToVote() {
        audioRef.current?.pause()
        if (finishPanel) void finishPanel().then((ok) => { if (!ok) setFinishFailed(true) })
    }

    const source = panelSourceLabel(experts)
    const speakingNow = activeTake?.status === 'ready' ? activeTake.label : ''
    const words = individual
        ? { heading: 'Expert panel · advice before your decision', skip: 'Skip to decisions', opens: 'Decisions open shortly.', advisory: 'Advisory only: experts cannot decide for you', failed: 'Decisions could not be opened automatically. The host can try Skip to decisions.' }
        : { heading: 'Expert panel · advice before the vote', skip: 'Skip to the vote', opens: 'Voting opens shortly.', advisory: 'Advisory only: experts cannot vote', failed: 'Voting could not be opened automatically. The host can try Skip to the vote.' }
    const problem = finishFailed ? (notice || words.failed) : ''

    return <motion.section
        className="opening-stage expert-stage"
        aria-labelledby="expert-panel-title"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
    >
        <div className="opening-meta">
            <h2 id="expert-panel-title" className="opening-pill expert-heading">{words.heading}</h2>
            <Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} className="opening-countdown" />
        </div>
        <p className="game-visually-hidden" role="status">{complete ? 'The expert panel has finished.' : speakingNow ? `${speakingNow} is speaking.` : 'The experts are preparing.'}</p>

        {!panel && <div className="opening-shimmer" aria-busy="true">
            <p className="opening-shimmer-label">The experts are reviewing the discussion…</p>
            <span /><span /><span />
            {error && <p className="opening-voice-notice">{error} Retrying automatically.</p>}
        </div>}

        <ol className="expert-cards">
            {experts.map((take, index) => {
                const status = panel ? expertCardStatus(experts, index, active) : 'preparing'
                const isActive = panel !== null && index === active
                const waitingForVoice = isActive && voiceDriven && startedIndex !== active
                const speaking = isActive && status === 'speaking' && !waitingForVoice && (playing || typedIndex !== active)
                const accent = expertAccent(take.kind)
                return <li key={take.kind} className={`expert-card expert-card--${status}${isActive ? ' is-active' : ''}${speaking ? ' is-speaking' : ''}`} style={{ '--expert-accent': accent } as CSSProperties}>
                    <div className="expert-card-head">
                        {isActive ? <Orb /> : <span className="expert-avatar" aria-hidden="true">{expertInitials(take.kind, take.label)}</span>}
                        <span className="expert-identity">
                            <span className="expert-name">{take.label}</span>
                            <span className="expert-persona">{expertPersona(take.kind, advisers)}</span>
                        </span>
                        <span className={`expert-status expert-status--${status}`}>{EXPERT_STATUS_LABELS[status]}</span>
                    </div>
                    {isActive && status === 'preparing' && <div className="opening-shimmer expert-shimmer" aria-busy="true"><span /><span /></div>}
                    {isActive && status === 'speaking' && waitingForVoice && <p className="expert-waiting">{blocked ? 'Waiting for you to allow sound…' : 'Preparing live voice…'}</p>}
                    {isActive && status === 'speaking' && !waitingForVoice && <Typewriter key={take.kind + take.text} text={take.text} onDone={markTyped} />}
                    {!isActive && status === 'done' && <p className="expert-text expert-text--done">{take.text}</p>}
                    {status === 'unavailable' && <p className="expert-text expert-text--done">No take this round{take.error ? `: ${take.error}` : '.'}</p>}
                </li>
            })}
        </ol>

        {activeUrl && activeTake && <audio key={activeTake.speech_id} ref={audioRef} src={activeUrl}
            onPlay={() => { setPlaying(true); setStartedIndex(active) }} onPause={() => setPlaying(false)} onEnded={() => endTurn(active)}
            onError={() => { setPlaying(false); setBlocked(false); setBrokenSpeech(activeTake.speech_id) }} />}

        <div className="opening-footer">
            <span className="opening-source">{words.advisory}</span>
            {source && <span className={`opening-source${source === 'Offline reply' ? ' is-offline' : ''}`}>{source}</span>}
            {blocked && <button type="button" className="opening-play" onClick={() => { void audioRef.current?.play().then(() => setBlocked(false)).catch(() => undefined) }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                Tap to hear the experts
            </button>}
            {blocked && <p className="opening-voice-notice" role="status">The browser blocked autoplay. Tap once to hear the live expert panel.</p>}
            {activeVoice?.state === 'unavailable' && <p className="opening-voice-notice" role="status">{activeVoice.message}</p>}
            {!PLAYS_VOICE && !complete && <p className="opening-voice-notice" role="status">Experts are speaking on the host's screen.</p>}
            {complete && !finishFailed && <p className="opening-voice-notice" role="status">{words.opens}</p>}
            {problem && <p className="opening-voice-notice" role="alert">{problem}</p>}
            {finishPanel && <button type="button" className="opening-link" onClick={skipToVote}>{words.skip}</button>}
        </div>
    </motion.section>
}
