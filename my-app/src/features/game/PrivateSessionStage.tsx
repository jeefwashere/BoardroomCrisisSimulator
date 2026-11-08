import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import type { RoomSnapshot } from '../../services/rooms'
import type { PrivateMessage, ResponseCardFields } from '../../services/facilitation'
import { facilitationApi, facilitationErrorMessage } from '../facilitation/facilitationClient'
import { seatFromSearch } from '../../services/tabSession'
import { appendTranscript } from './dictationModel'
import type { useDictation } from './useDictation'
import type { AttachDictation } from './IndividualDecisionPanel'
import type { PrivateSessionHandle } from './usePrivateSession'
import { PRIVATE_OBSERVER, PRIVATE_UNAVAILABLE } from './usePrivateSession'
import { formatClock } from './controlBarModel'
import { AssessmentResults, PrivateBoard } from './PrivateSessionReport'
import { QuizResults, QuizStage } from './PrivateQuiz'
import { currentQuestion, quizChips, quizScoreText } from './quizModel'
import Countdown from './Countdown'
import { useReportAgent } from '../boardroom3d/agentPresence'
import CallTile from './CallTile'
import { playerAvatarColor, playerInitials } from './playerPresentation'
import { privateAutoEntry, privateEntry, privateTranscriptLines, silentHoldMs } from './transcriptModel'
import { audioDurationMs, audioElapsedMs } from './useAutoResponse'
import type { AutoPlayback } from './useAutoResponse'
import { useLiveSpeech, useSpokenLine } from './useTranscript'
import type { TranscriptWriter } from './useTranscript'
import {
    ANSWER_LIMIT, CARD_FIELDS, CARD_FIELD_LIMIT, NEEDS_CONFIRMATION, canConfirmCard, canSubmitAnswer, expectingKey, initiallySpoken, nextToSpeak, privateRoundLabel,
    questionText, scoreText, stageChips, trimCard,
} from './privateSessionModel'

// Roughly the pace of spoken ElevenLabs speech, used to hold silent lines about as long as the voice would take.
const CHARS_PER_SECOND = 16
// Pause after a silent line before the next one starts; silent lines never hold the floor longer than SILENT_MAX_MS.
const HOLD_MS = 900
const SILENT_MAX_MS = 4000
const SPEECH_RETRIES = 12
// In the one window demo only the first seat plays sound, so frames never talk over each other.
const SEAT = typeof window === 'undefined' ? null : seatFromSearch(window.location.search)
const PLAYS_VOICE = SEAT === null || SEAT === 'alex'

type Dictation = ReturnType<typeof useDictation>
type Voice = { state: 'loading' } | { state: 'ready'; url: string } | { state: 'unavailable'; message: string }

/** Prepares each new agent message's speech as soon as it is ready, so the next line starts without a gap. */
function useAgentVoices(roomId: string, messages: readonly PrivateMessage[], spoken: ReadonlySet<string> | null, enabled: boolean) {
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
        if (!enabled || !spoken) return
        const settle = (speechId: string, voice: Voice) => { if (alive.current) setVoices((current) => ({ ...current, [speechId]: voice })) }
        async function load(speechId: string, attempt = 0): Promise<void> {
            try {
                const prepared = await facilitationApi.prepareSpeech(roomId, speechId)
                if (!alive.current) return
                if (prepared.status === 'pending') {
                    if (attempt < SPEECH_RETRIES) { await new Promise((resolve) => setTimeout(resolve, 1200)); return load(speechId, attempt + 1) }
                    settle(speechId, { state: 'unavailable', message: 'The voice took too long to prepare. The text stays readable.' }); return
                }
                if (prepared.status === 'disabled') { settle(speechId, { state: 'unavailable', message: 'Spoken replies are turned off for this session.' }); return }
                if (prepared.status !== 'ready') { settle(speechId, { state: 'unavailable', message: prepared.error || 'The voice could not be prepared. The text stays readable.' }); return }
                const blob = await facilitationApi.speechAudio(roomId, speechId)
                if (!alive.current) return
                const url = URL.createObjectURL(blob)
                urls.current.push(url)
                settle(speechId, { state: 'ready', url })
            } catch (failure) {
                settle(speechId, { state: 'unavailable', message: facilitationErrorMessage(failure, 'The voice is unavailable. The text stays readable.') })
            }
        }
        for (const item of messages) {
            if (item.author !== 'agent' || item.status !== 'ready' || !item.speech_id || spoken.has(item.message_id) || requested.current.has(item.speech_id)) continue
            requested.current.add(item.speech_id)
            void load(item.speech_id)
        }
    }, [roomId, messages, spoken, enabled])
    return useCallback((item: PrivateMessage): Voice | null => {
        if (!enabled || item.status !== 'ready' || !item.speech_id) return null
        return voices[item.speech_id] ?? { state: 'loading' }
    }, [enabled, voices])
}

function LockIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
}

/** The answer box: the current question above a textarea. The bar's Mic dictates into it; Auto response submits a saved clip instead. */
function AnswerComposer({ question, draft, setDraft, disabled, onSubmit, dictation }: {
    question: string; draft: string; setDraft: (text: string) => void; disabled: boolean; onSubmit: () => void; dictation: Dictation
}) {
    return <form className="private-composer" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
        <label className="private-composer-label">
            <span className="private-eyebrow">Your coach asks</span>
            <span className="private-question">{question}</span>
            <textarea rows={4} maxLength={ANSWER_LIMIT} value={draft} placeholder="Type your answer, or use Dictate or Auto response below." onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSubmit() } }} />
        </label>
        {(dictation.listening || dictation.note) && <div className="private-voice">
            {dictation.listening && <span className="private-listening" role="status"><span className="vote-waiting-dot" aria-hidden="true" />Listening…</span>}
            {dictation.listening && dictation.interim && <span className="private-interim" aria-live="polite">{dictation.interim}</span>}
            {dictation.note && <span role="status">{dictation.note}</span>}
        </div>}
        <div className="private-actions">
            <span className="private-hint">Only your crisis coach sees this answer.</span>
            <button type="submit" className="opening-play" disabled={disabled || !canSubmitAnswer(draft)}>Submit answer</button>
        </div>
    </form>
}

function ResponseCardForm({ initial, disabled, onConfirm }: { initial: ResponseCardFields; disabled: boolean; onConfirm: (fields: ResponseCardFields) => Promise<boolean> }) {
    const [fields, setFields] = useState(initial)
    return <form className="private-card" onSubmit={(event) => { event.preventDefault(); if (canConfirmCard(fields) && !disabled) void onConfirm(trimCard(fields)) }}>
        <header>
            <p className="private-eyebrow">Round 2 · Response card</p>
            <h3>Check and correct your response card</h3>
            <p className="private-hint">Your coach drafted this from your answers. Fill in every field; write “{NEEDS_CONFIRMATION}” for anything still unknown. Preparation earns no points.</p>
        </header>
        <div className="private-card-fields">
            {CARD_FIELDS.map(({ key, label, hint }) => <label key={key} className="private-card-field">
                <span><strong>{label}</strong> <small>{hint}</small></span>
                <textarea rows={3} maxLength={CARD_FIELD_LIMIT} value={fields[key]} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} />
            </label>)}
        </div>
        <div className="private-actions">
            <button type="submit" className="opening-play" disabled={disabled || !canConfirmCard(fields)}>Confirm response card</button>
        </div>
    </form>
}

type AutoClip = { playing: boolean; caption: string; key: string | null; playback: AutoPlayback | null }

type Props = {
    room: RoomSnapshot
    handle: PrivateSessionHandle
    /** The control bar's Auto response for the current question (its clip plays from the bar). */
    auto: AutoClip
    selfName: string
    selfRole: string
    dictation: Dictation
    attachDictation: AttachDictation
    notice?: string
    transcript: TranscriptWriter
    /** The live transcript panel's answer slot; null when captions are off (or chat covers them), so the answer box floats on the stage. */
    dock: HTMLElement | null
}

/**
 * Rounds 2 and 3 as a one to one call: the member's window and the crisis coach's window (examiner in Round 3).
 * Only the voices play on the stage; every line goes to the live transcript, where the answer box also lives.
 */
export default function PrivateSessionStage({ room, handle, auto, selfName, selfRole, dictation, attachDictation, notice, transcript, dock }: Props) {
    const { session, unavailable, error, sending } = handle
    const messages = useMemo(() => session?.messages ?? [], [session?.messages])
    const [spoken, setSpoken] = useState<ReadonlySet<string> | null>(null)
    const [startedId, setStartedId] = useState<string | null>(null)
    const [playing, setPlaying] = useState(false)
    const [blocked, setBlocked] = useState(false)
    const [brokenSpeech, setBrokenSpeech] = useState<string | null>(null)
    const [draft, setDraftState] = useState({ key: '', text: '' })
    const audioRef = useRef<HTMLAudioElement>(null)
    // Captions of Auto response clips already in the transcript, so the submitted answer is not listed twice.
    const captioned = useRef(new Set<string>())
    const [captionedCount, setCaptionedCount] = useState(0)
    const live = useLiveSpeech(transcript)
    // Earlier messages are not replayed when the stage opens again (reload); the current question is.
    if (session && spoken === null) setSpoken(initiallySpoken(session.messages, session.quiz))
    const voiceFor = useAgentVoices(room.room_id, messages, spoken, PLAYS_VOICE)
    const current = spoken ? nextToSpeak(messages, spoken) : null
    // Auto response plays the member's own clip: the coach falls silent and its pending lines go to the transcript in full.
    if (auto.playing && current && current.status === 'ready' && spoken) setSpoken(new Set([...spoken, ...messages.filter((item) => item.author === 'agent' && item.status === 'ready').map((item) => item.message_id)]))
    const voice = current ? voiceFor(current) : null
    const voiceDriven = voice !== null && voice.state !== 'unavailable' && brokenSpeech !== current?.speech_id
    const activeUrl = voiceDriven && voice?.state === 'ready' ? voice.url : null
    const waitingForVoice = Boolean(current && voiceDriven && startedId !== current.message_id && !blocked)
    const caughtUp = spoken !== null && current === null

    const markSpoken = useCallback((id: string) => setSpoken((set) => set && !set.has(id) ? new Set([...set, id]) : set), [])

    const round = session?.round ?? 2
    const examiner = session?.agent.role === 'examiner' || round === 3
    const agentName = session?.agent.label || 'Crisis coach'
    const visibleCount = current ? messages.indexOf(current) + 1 : messages.length
    const currentReadyText = current?.status === 'ready' ? current.text : null
    const currentId = current?.message_id ?? null

    // Lines already revealed go to the transcript in full; the voiced line is added when its audio starts.
    useEffect(() => {
        if (!session) return
        for (const line of privateTranscriptLines(messages, visibleCount, currentId, agentName, selfName, captioned.current)) transcript.upsert(line)
    }, [session, messages, visibleCount, currentId, agentName, selfName, transcript, captionedCount])

    // Silent lines (no voice, or another seat's frame) go to the transcript in full and move on after a short hold.
    useEffect(() => {
        if (!current || currentReadyText === null || voiceDriven) return
        transcript.upsert(privateEntry(current, agentName, selfName))
        const timer = setTimeout(() => markSpoken(current.message_id), silentHoldMs(currentReadyText, CHARS_PER_SECOND, HOLD_MS, SILENT_MAX_MS))
        return () => clearTimeout(timer)
    }, [current, currentReadyText, voiceDriven, markSpoken, transcript, agentName, selfName])

    useEffect(() => {
        const element = audioRef.current
        if (!element || !activeUrl) return
        element.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
    }, [activeUrl])

    // The member's saved answer clip: captioned in step with its audio while it plays from the control bar.
    const autoLine = auto.playback && auto.key ? { entry: privateAutoEntry(auto.key, selfName, auto.caption), durationMs: auto.playback.durationMs } : null
    useSpokenLine(transcript, autoLine)
    const autoCaption = autoLine ? auto.caption.trim() : ''
    useEffect(() => {
        if (!autoCaption || captioned.current.has(autoCaption)) return
        captioned.current.add(autoCaption)
        setCaptionedCount((count) => count + 1)
    }, [autoCaption])

    const answerKey = expectingKey(session ?? null) ?? ''
    const draftText = draft.key === answerKey ? draft.text : ''
    const setDraft = useCallback((text: string) => setDraftState({ key: answerKey, text }), [answerKey])
    const showComposer = Boolean(session?.expecting && caughtUp && !auto.playing && (session.stage === 'coaching' || session.stage === 'assessment'))
    // The control bar's Mic dictates into the answer box; final words are appended and stay editable.
    useEffect(() => {
        if (!showComposer) return
        attachDictation((words) => setDraftState((value) => ({ key: answerKey, text: appendTranscript(value.key === answerKey ? value.text : '', words) })))
        return () => attachDictation(null)
    }, [showComposer, answerKey, attachDictation])

    async function submit() {
        if (!canSubmitAnswer(draftText) || sending || session?.busy) return
        dictation.stop()
        // A failed submission keeps the draft; the footer shows the reason.
        if (await handle.answer(draftText.trim(), false)) setDraftState({ key: answerKey, text: '' })
    }

    function showAll() {
        audioRef.current?.pause()
        setPlaying(false)
        live.end()
        setSpoken(new Set(messages.filter((item) => item.author === 'agent').map((item) => item.message_id)))
    }

    // Round 3 is multiple choice on the main stage (no answer box in the dock); choices show as soon as a question arrives.
    const quiz = session?.stage === 'assessment' ? session.quiz : null
    const choosing = Boolean(quiz && currentQuestion(quiz))

    const coachTalking = playing || Boolean(current && current.status === 'ready' && !voiceDriven)
    const selfTalking = auto.playing || dictation.listening
    // The 3D boardroom lights the table hub while the coach (or examiner) speaks.
    useReportAgent(coachTalking ? { kind: 'coach', name: examiner ? `${agentName} · examiner` : agentName, role: examiner ? 'AI examiner · scored assessment' : 'AI crisis coach · private', accent: examiner ? '#b58c28' : null } : null)
    const coachState = handle.notEligible ? 'Observing' : unavailable ? 'Unavailable'
        : !session ? (error ? 'Reconnecting' : 'Connecting')
        : current?.status === 'pending' ? 'Thinking'
        : waitingForVoice ? 'Preparing voice'
        : coachTalking ? 'Speaking'
        : quiz?.status === 'generating' ? 'Writing questions'
        : session.busy ? (session.stage === 'assessment' ? 'Scoring' : 'Thinking')
        : session.stage === 'complete' ? 'Complete'
        : session.stage === 'card' ? (session.card?.status === 'draft' ? 'Waiting for your card' : 'Recording card')
        : choosing ? 'Waiting for your answer'
        : 'Listening'
    const selfState = auto.playing ? 'Saved answer' : dictation.listening ? 'Dictating' : showComposer || choosing ? 'Your turn' : undefined
    const complete = session?.stage === 'complete' && caughtUp
    // The quiz keeps the stage until the review takes over (including the last result while the examiner reads it).
    const stageQuiz = session && !complete && (session.stage === 'assessment' || session.stage === 'complete') ? session.quiz : null
    const problem = error || notice

    const dockContent = session && !complete && !stageQuiz && <div className="private-dock">
        {showComposer && session.expecting && <AnswerComposer question={questionText(session)} draft={draftText} setDraft={setDraft} disabled={sending || session.busy}
            onSubmit={() => void submit()} dictation={dictation} />}
        {auto.playing && <p className="private-note" role="status">Playing your saved answer. It is submitted when the clip ends.</p>}
        {!showComposer && !auto.playing && session.expecting && !caughtUp && <p className="private-note">The answer box opens when {agentName} finishes speaking.</p>}
        {session.busy && !session.retryable && session.stage !== 'card' && <p className="private-note" role="status">{session.stage === 'assessment' ? `${agentName} is scoring your answer…` : `${agentName} is thinking…`}</p>}
        {session.retryable && <div className="private-retry" role="alert">
            <p>{agentName} could not respond. Your answers are kept.</p>
            <button type="button" className="opening-play" disabled={sending || session.busy} onClick={() => void handle.retry()}>Retry</button>
        </div>}
        {session.stage === 'card' && caughtUp && (session.card?.status === 'draft'
            ? <ResponseCardForm key={session.card.fields.action} initial={session.card.fields} disabled={sending || session.busy} onConfirm={handle.confirmCard} />
            : session.card?.status === 'confirmed' ? <p className="private-note" role="status">Response card confirmed. The assessment begins shortly.</p>
            : <div className="opening-shimmer private-card-recording" aria-busy="true"><p className="opening-shimmer-label">{agentName} is recording your response card from your answers…</p><span /><span /></div>)}
    </div>

    return <motion.section
        className={`call-stage private-call${examiner ? ' is-examiner' : ''}`}
        aria-labelledby="private-title"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
    >
        <div className="call-stage-head private-head">
            <h2 id="private-title" className="opening-pill private-pill">{privateRoundLabel(round)}</h2>
            <span className="private-lock"><LockIcon />Private: only you and your crisis coach</span>
            {round === 3 && session && (session.quiz ? <ol className="private-chips private-chips--compact" aria-label="Assessment questions">
                {quizChips(session.quiz).map((chip) => <li key={chip.step} className={`private-chip private-chip--${chip.status}`}>
                    <span><span aria-hidden="true">Q{chip.step}</span><span className="game-visually-hidden">Question {chip.step}</span></span><strong>{chip.text}</strong>
                </li>)}
            </ol> : <ol className="private-chips private-chips--compact" aria-label="Assessment stages">
                {stageChips(session.assessment).map((chip) => <li key={chip.step} className={`private-chip private-chip--${chip.status}`}><span>Stage {chip.step}</span><strong>{chip.text}</strong></li>)}
            </ol>)}
            <span className="private-meta-end">
                {round === 3 && session && <span className="private-score" role="status">{session.quiz ? quizScoreText(session.quiz) : scoreText(session.assessment)}</span>}
                {room.game?.phase_deadline && <Countdown key={room.game.phase_id + (room.game.server_time ?? '')} deadline={room.game.phase_deadline} serverTime={room.game.server_time} className="opening-countdown" format={formatClock} />}
            </span>
        </div>
        <p className="game-visually-hidden" role="status">{coachTalking ? `${agentName} is speaking. Their words are in the live transcript.` : ''}</p>

        {unavailable && <p className="opening-problem" role="alert">{PRIVATE_UNAVAILABLE}</p>}
        {handle.notEligible && <p className="opening-problem" role="status">{PRIVATE_OBSERVER}</p>}
        {handle.notEligible && <PrivateBoard progress={room.game?.private_progress} selfId={room.self_member_id} />}

        {complete && session ? <div className="private-complete">
            {session.quiz ? <QuizResults quiz={session.quiz} /> : <AssessmentResults assessment={session.assessment} />}
            <PrivateBoard progress={room.game?.private_progress} selfId={room.self_member_id} />
        </div> : stageQuiz && session ? <QuizStage quiz={stageQuiz} blocked={sending || session.busy} agentName={agentName} retryable={session.retryable}
            onChoose={handle.choose} onRetry={handle.retry} />
        : !handle.notEligible && <div className="call-duo">
            <CallTile name={`${selfName} (you)`} role={selfRole} size="main" talking={selfTalking} status={selfState}
                avatar={{ kind: 'initials', text: playerInitials(selfName), color: playerAvatarColor(room.self_member_id) }} />
            <CallTile name={examiner ? `${agentName} · examiner` : agentName} role={examiner ? 'AI examiner · scored assessment' : 'AI crisis coach · private'} size="main"
                talking={coachTalking} status={coachState} avatar={{ kind: 'orb' }} accent={examiner ? '#b58c28' : undefined} className="call-tile--coach" />
        </div>}

        {activeUrl && current && <audio key={current.speech_id} ref={audioRef} src={activeUrl}
            onPlaying={(event) => { setPlaying(true); setStartedId(current.message_id); live.start(privateEntry(current, agentName, selfName), audioDurationMs(event.currentTarget), audioElapsedMs(event.currentTarget)) }}
            onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); live.end(); markSpoken(current.message_id) }}
            onError={() => { setPlaying(false); setBlocked(false); live.end(); setBrokenSpeech(current.speech_id) }} />}

        <div className="opening-footer call-stage-footer">
            {blocked && activeUrl && <button type="button" className="opening-play" onClick={() => { void audioRef.current?.play().then(() => setBlocked(false)).catch(() => undefined) }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                Tap to hear
            </button>}
            {blocked && activeUrl && <p className="opening-voice-notice" role="status">The browser blocked autoplay. Tap once to hear your coach.</p>}
            {voice?.state === 'unavailable' && <p className="opening-voice-notice" role="status">{voice.message}</p>}
            {current && current.status === 'ready' && <button type="button" className="opening-link" onClick={showAll} title="Stop the coach's voice and put the remaining lines in the transcript">Skip ahead</button>}
            {problem && !unavailable && <p className="opening-voice-notice" role="alert">{problem}</p>}
        </div>

        {dockContent && (dock ? createPortal(dockContent, dock) : <div className="private-dock-float">{dockContent}</div>)}
    </motion.section>
}
