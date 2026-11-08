import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { RoomSnapshot } from '../../services/rooms'
import { createFacilitationApi } from '../../services/facilitation'
import type { Opening } from '../../services/facilitation'
import { roomApi, errorMessage } from '../rooms/useRoom'
import { pollRoom } from '../rooms/roomState'
import Countdown from './Countdown'
import IncidentReportCard from './IncidentReportCard'
import { seatFromSearch } from '../../services/tabSession'

const facilitationApi = createFacilitationApi(roomApi)
const TYPE_STEP = 2
const TYPE_INTERVAL_MS = 22
// In the one window demo only the first seat (the host) plays sound, so three frames never talk over each other.
const SEAT = typeof window === 'undefined' ? null : seatFromSearch(window.location.search)
const PLAYS_VOICE = SEAT === null || SEAT === 'alex'

function useOpening(roomId: string) {
    const [opening, setOpening] = useState<Opening | null>(null)
    const [error, setError] = useState('')
    useEffect(() => {
        const stop: () => void = pollRoom((signal) => facilitationApi.state(roomId, signal), (state) => {
            setOpening(state.opening)
            setError('')
            // Stop once the opening job has a terminal status; speech is prepared on demand.
            if (state.opening && state.opening.status !== 'pending') stop()
        }, (failure) => setError(errorMessage(failure)), 2000)
        return stop
    }, [roomId])
    return { opening, error }
}

function Typewriter({ text, onTypingChange }: { text: string; onTypingChange: (typing: boolean) => void }) {
    const reduceMotion = useReducedMotion()
    const [count, setCount] = useState(0)
    const [skipped, setSkipped] = useState(false)
    const complete = reduceMotion || skipped || count >= text.length
    useEffect(() => {
        if (complete) { onTypingChange(false); return }
        onTypingChange(true)
        const timer = setInterval(() => setCount((current) => Math.min(text.length, current + TYPE_STEP)), TYPE_INTERVAL_MS)
        return () => clearInterval(timer)
    }, [complete, text, onTypingChange])
    const visible = complete ? text : text.slice(0, count)
    return <div className="opening-text">
        <p className="game-visually-hidden">{text}</p>
        <p aria-hidden="true">{visible}{!complete && <span className="opening-caret" />}</p>
        {!complete && <button type="button" className="opening-link" onClick={() => setSkipped(true)}>Show full briefing</button>}
    </div>
}

type Props = {
    room: RoomSnapshot
    /** Host only: ends the briefing for the whole room once the spoken opening has played. */
    finishBriefing?: () => Promise<boolean>
    /** Hides the opening on this screen only (non host, or when the room command is unavailable). */
    onDismiss: () => void
}

export default function OpeningBriefing({ room, finishBriefing, onDismiss }: Props) {
    const game = room.game
    const { opening, error } = useOpening(room.room_id)
    const [typing, setTyping] = useState(false)
    const [audio, setAudio] = useState<{ speechId: string; url: string } | null>(null)
    const [playing, setPlaying] = useState(false)
    const [voice, setVoice] = useState<{ busy: boolean; notice: string }>({ busy: false, notice: '' })
    const [blocked, setBlocked] = useState(false)
    const autoStarted = useRef<string | null>(null)
    const audioRef = useRef<HTMLAudioElement>(null)
    useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url) }, [audio])
    const autoSpeechId = opening?.status === 'ready' ? opening.speech_id : null
    // Live Gemini text is spoken through ElevenLabs as soon as it is ready; no click required.
    useEffect(() => {
        if (!PLAYS_VOICE || !autoSpeechId || autoStarted.current === autoSpeechId) return
        autoStarted.current = autoSpeechId
        void playBriefing()
    })
    useEffect(() => {
        const element = audioRef.current
        if (!element || !audio) return
        element.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
    }, [audio])
    if (!game) return null

    const status = error && !opening ? 'unreachable' : opening?.status ?? 'pending'
    const speaking = playing || (status === 'ready' && typing)
    const speechId = opening?.speech_id ?? null

    async function finished() {
        setPlaying(false)
        if (finishBriefing && await finishBriefing()) return
        onDismiss()
    }

    async function playBriefing(attempt = 0): Promise<void> {
        const speechId = opening?.speech_id
        if (!speechId || (voice.busy && attempt === 0)) return
        if (audio?.speechId === speechId) return
        setVoice({ busy: true, notice: '' })
        try {
            const prepared = await facilitationApi.prepareSpeech(room.room_id, speechId)
            if (prepared.status === 'disabled') { setVoice({ busy: false, notice: 'Spoken briefing is turned off for this session. The briefing stays readable here.' }); return }
            if (prepared.status === 'pending') {
                if (attempt < 10) { await new Promise((resolve) => setTimeout(resolve, 1500)); return playBriefing(attempt + 1) }
                setVoice({ busy: false, notice: 'The voice is still being prepared. Try again in a moment.' }); return
            }
            if (prepared.status !== 'ready') { setVoice({ busy: false, notice: prepared.error || 'The spoken briefing could not be prepared. The text remains available.' }); return }
            const blob = await facilitationApi.speechAudio(room.room_id, speechId)
            setAudio({ speechId, url: URL.createObjectURL(blob) })
            setVoice({ busy: false, notice: '' })
        } catch (failure) {
            setVoice({ busy: false, notice: errorMessage(failure) })
        }
    }

    const sourceLabel = opening?.source === 'offline' ? 'Offline briefing: the hosted model was unavailable, so this text was prepared from the scenario documents.'
        : opening?.source === 'vertex' ? 'Generated live by Gemini (Vertex AI) · voiced by ElevenLabs'
        : opening?.source === 'hosted' ? 'Generated by the AI facilitator' : null

    return <motion.section
        className={`opening-stage${speaking ? ' is-speaking' : ''}`}
        aria-labelledby="opening-title"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
    >
        <div className="opening-meta">
            <span className="opening-pill">{room.phase === 'reading' ? 'Reading the situation' : 'Opening briefing'}</span>
            <Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} className="opening-countdown" />
        </div>
        <div className="opening-presence">
            <div className="opening-orb" aria-hidden="true">
                <span className="opening-ring" />
                <span className="opening-ring opening-ring--late" />
                <span className="opening-core"><span className="opening-wave" /><span className="opening-wave" /><span className="opening-wave" /><span className="opening-wave" /></span>
            </div>
            <div className="opening-identity">
                <span className="opening-name">AI facilitator</span>
                <span className="opening-state" role="status">{status === 'pending' ? 'Preparing the briefing' : status === 'ready' ? (speaking ? 'Speaking' : 'Briefing ready') : status === 'failed' ? 'Briefing unavailable' : 'Facilitator offline'}</span>
            </div>
        </div>
        <p className="opening-scenario">{game.scenario.title}</p>
        <h2 id="opening-title" className="opening-title">{opening?.title || 'Opening briefing'}</h2>

        {status === 'pending' && <div className="opening-shimmer" aria-busy="true">
            <p className="opening-shimmer-label">Facilitator is preparing the briefing…</p>
            <span /><span /><span />
        </div>}
        {status === 'ready' && opening && <Typewriter key={opening.text} text={opening.text} onTypingChange={setTyping} />}
        {status === 'failed' && <p className="opening-problem" role="alert">The AI facilitator could not prepare an opening briefing{opening?.error ? `: ${opening.error}` : '.'} Read the public scenario documents beside the call to prepare.</p>}
        {status === 'unreachable' && <p className="opening-problem" role="alert">The facilitator service is offline ({error}). Retrying automatically. The public scenario documents remain available.</p>}

        <div className="opening-footer">
            {status === 'ready' && sourceLabel && <span className={`opening-source${opening?.source === 'offline' ? ' is-offline' : ''}`}>{sourceLabel}</span>}
            {status === 'ready' && speechId && PLAYS_VOICE && (!audio || blocked) && <button type="button" className="opening-play" disabled={voice.busy} onClick={() => { if (blocked) { void audioRef.current?.play().then(() => setBlocked(false)) } else void playBriefing() }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                {voice.busy ? 'Preparing live voice…' : blocked ? 'Tap to hear the briefing' : 'Play briefing'}
            </button>}
            {blocked && <p className="opening-voice-notice" role="status">The browser blocked autoplay. Tap once to hear the live briefing.</p>}
            {!PLAYS_VOICE && status === 'ready' && <p className="opening-voice-notice" role="status">The live briefing is playing on the host's screen. This view closes when it ends.</p>}
            {audio && audio.speechId === speechId && <audio ref={audioRef} className="opening-audio" controls src={audio.url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => void finished()} />}
            {status !== 'pending' && <button type="button" className="opening-link" onClick={() => { audioRef.current?.pause(); void finished() }}>{finishBriefing ? 'Skip to the call for everyone' : 'Skip to the call'}</button>}
            {voice.notice && <p className="opening-voice-notice" role="status">{voice.notice}</p>}
        </div>
        <IncidentReportCard roomId={room.room_id} />
        <p className="opening-next">The call opens for every participant as soon as the spoken briefing ends.</p>
    </motion.section>
}
