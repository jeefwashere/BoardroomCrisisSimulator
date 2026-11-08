import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { RoomSnapshot } from '../../services/rooms'
import { createFacilitationApi } from '../../services/facilitation'
import type { Opening } from '../../services/facilitation'
import { roomApi, errorMessage } from '../rooms/useRoom'
import { pollRoom } from '../rooms/roomState'
import Countdown from './Countdown'
import { useReportAgent } from '../boardroom3d/agentPresence'
import { seatFromSearch } from '../../services/tabSession'
import type { LobbyMember } from '../lobby/lobbyModel'
import CallTile, { MemberStrip } from './CallTile'
import { briefingEntry } from './transcriptModel'
import { audioDurationMs, audioElapsedMs } from './useAutoResponse'
import { useLiveSpeech } from './useTranscript'
import type { TranscriptWriter } from './useTranscript'

const facilitationApi = createFacilitationApi(roomApi)
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

type Props = {
    room: RoomSnapshot
    /** Host only: ends the briefing for the whole room once the spoken opening has played. */
    finishBriefing?: () => Promise<boolean>
    /** Hides the opening on this screen only (non host, or when the room command is unavailable). */
    onDismiss: () => void
    /** Members shown as small tiles under the agent's window. */
    members: readonly LobbyMember[]
    /** The briefing text goes to the live transcript, in step with its audio. */
    transcript: TranscriptWriter
}

/** The opening as a call: the preparation agent's window, the members' small tiles, and the briefing as audio only. */
export default function OpeningBriefing({ room, finishBriefing, onDismiss, members, transcript }: Props) {
    const game = room.game
    const { opening, error } = useOpening(room.room_id)
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
    const live = useLiveSpeech(transcript)
    const readyText = opening?.status === 'ready' && opening.text ? opening : null
    // Without a voice on this screen (another seat, voice off or failed) the briefing goes to the transcript in full at once.
    const silent = Boolean(readyText && (!PLAYS_VOICE || !readyText.speech_id || (voice.notice && !voice.busy && !audio)))
    useEffect(() => { if (readyText && silent) transcript.upsert(briefingEntry(readyText)) }, [readyText, silent, transcript])
    // The 3D boardroom lights the table hub while the preparation agent speaks.
    useReportAgent(playing ? { kind: 'agent', name: 'Preparation agent', role: 'AI agent · opening briefing', accent: null } : null)
    if (!game) return null

    const status = error && !opening ? 'unreachable' : opening?.status ?? 'pending'
    const speaking = playing
    const speechId = opening?.speech_id ?? null

    async function finished() {
        setPlaying(false)
        // Skipped or ended: the whole briefing stays readable in the transcript.
        if (readyText) { transcript.upsert(briefingEntry(readyText)); live.end() }
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

    const agentState = status === 'pending' ? 'Preparing' : status === 'ready' ? (speaking ? 'Speaking' : voice.busy ? 'Preparing voice' : 'Ready') : status === 'failed' ? 'Unavailable' : 'Offline'

    return <motion.section
        className="call-stage opening-call"
        aria-labelledby="opening-title"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
    >
        <div className="call-stage-head">
            <h2 id="opening-title" className="opening-pill">{room.phase === 'reading' ? 'Reading the situation' : 'Opening briefing'}</h2>
            <span className="call-stage-meta">{game.scenario.title}</span>
            <Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} className="opening-countdown" />
        </div>
        <p className="game-visually-hidden" role="status">{status === 'pending' ? 'The preparation agent is preparing the briefing.' : speaking ? 'The preparation agent is speaking. The briefing text is in the live transcript.' : ''}</p>
        <div className="call-stage-main">
            <CallTile name="Preparation agent" role="AI agent · opening briefing" size="main" talking={speaking} status={agentState} avatar={{ kind: 'orb' }} />
        </div>
        <MemberStrip members={members} selfId={room.self_member_id} />

        <div className="opening-footer call-stage-footer">
            {status === 'ready' && speechId && PLAYS_VOICE && (!audio || blocked) && <button type="button" className="opening-play" disabled={voice.busy} onClick={() => { if (blocked) { void audioRef.current?.play().then(() => setBlocked(false)) } else void playBriefing() }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                {voice.busy ? 'Preparing live voice…' : blocked ? 'Tap to hear the briefing' : 'Play briefing'}
            </button>}
            {blocked && <p className="opening-voice-notice" role="status">The browser blocked autoplay. Tap once to hear the live briefing.</p>}
            {!PLAYS_VOICE && status === 'ready' && <p className="opening-voice-notice" role="status">The live briefing is playing on the host's screen. This view closes when it ends.</p>}
            {status === 'failed' && <p className="opening-voice-notice" role="alert">The preparation agent could not prepare an opening briefing{opening?.error ? `: ${opening.error}` : '.'} The public scenario documents remain available.</p>}
            {status === 'unreachable' && <p className="opening-voice-notice" role="alert">The facilitator service is offline ({error}). Retrying automatically.</p>}
            {audio && audio.speechId === speechId && <audio ref={audioRef} className="opening-audio" src={audio.url}
                onPlaying={(event) => { setPlaying(true); if (readyText) live.start(briefingEntry(readyText), audioDurationMs(event.currentTarget), audioElapsedMs(event.currentTarget)) }}
                onPause={() => setPlaying(false)} onEnded={() => void finished()} />}
            {voice.notice && <p className="opening-voice-notice" role="status">{voice.notice}</p>}
        </div>
    </motion.section>
}
