import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
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
import Countdown from './Countdown'
import {
    ANSWER_LIMIT, CARD_FIELDS, CARD_FIELD_LIMIT, NEEDS_CONFIRMATION, canConfirmCard, canSubmitAnswer, expectingKey, initiallySpoken, nextToSpeak, privateRoundLabel,
    questionText, scoreText, stageChips, transitionIndex, trimCard,
} from './privateSessionModel'

// Roughly the pace of spoken ElevenLabs speech, so the text keeps up with the voice.
const CHARS_PER_SECOND = 16
// Pause after a silent message finishes typing, before the next one starts.
const HOLD_MS = 900
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

function Typewriter({ text, onDone }: { text: string; onDone: () => void }) {
    const reduceMotion = useReducedMotion()
    const [count, setCount] = useState(0)
    const complete = reduceMotion || count >= text.length
    useEffect(() => {
        if (complete) { onDone(); return }
        const timer = setInterval(() => setCount((current) => Math.min(text.length, current + 1)), 1000 / CHARS_PER_SECOND)
        return () => clearInterval(timer)
    }, [complete, text, onDone])
    return <>
        <span className="game-visually-hidden">{text}</span>
        <span aria-hidden="true">{complete ? text : text.slice(0, count)}{!complete && <span className="opening-caret" />}</span>
    </>
}

function Orb() {
    return <div className="opening-orb private-orb" aria-hidden="true">
        <span className="opening-ring" />
        <span className="opening-ring opening-ring--late" />
        <span className="opening-core"><span className="opening-wave" /><span className="opening-wave" /><span className="opening-wave" /><span className="opening-wave" /></span>
    </div>
}

function LockIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
}

function AnswerComposer({ question, disabled, onSubmit, dictation, attachDictation }: {
    question: string; disabled: boolean; onSubmit: (text: string) => Promise<boolean>; dictation: Dictation; attachDictation: AttachDictation
}) {
    const [draft, setDraft] = useState('')
    // The control bar's Mic dictates into this box; final words are appended and stay editable.
    useEffect(() => {
        attachDictation((words) => setDraft((current) => appendTranscript(current, words)))
        return () => attachDictation(null)
    }, [attachDictation])
    async function submit() {
        if (!canSubmitAnswer(draft) || disabled) return
        dictation.stop()
        // A failed submission keeps the draft; the stage footer shows the reason.
        if (await onSubmit(draft.trim())) setDraft('')
    }
    return <form className="private-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label className="private-composer-label">
            <span className="private-question">{question}</span>
            <textarea rows={4} maxLength={ANSWER_LIMIT} value={draft} placeholder="Type your answer, or use Dictate below to speak it." onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() } }} />
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

type Props = {
    room: RoomSnapshot
    handle: PrivateSessionHandle
    /** The control bar's Auto response is playing the member's saved clip. */
    autoPlaying: boolean
    autoCaption: string
    selfName: string
    dictation: Dictation
    attachDictation: AttachDictation
    notice?: string
}

/** Rounds 2 and 3: the member's private conversation with one crisis coach, who becomes the examiner. */
export default function PrivateSessionStage({ room, handle, autoPlaying, autoCaption, selfName, dictation, attachDictation, notice }: Props) {
    const { session, unavailable, error, sending } = handle
    const messages = session?.messages ?? []
    const [spoken, setSpoken] = useState<ReadonlySet<string> | null>(null)
    const [typedId, setTypedId] = useState<string | null>(null)
    const [startedId, setStartedId] = useState<string | null>(null)
    const [playing, setPlaying] = useState(false)
    const [blocked, setBlocked] = useState(false)
    const [brokenSpeech, setBrokenSpeech] = useState<string | null>(null)
    const audioRef = useRef<HTMLAudioElement>(null)
    const endRef = useRef<HTMLDivElement>(null)
    // Earlier messages are not replayed when the stage opens again (reload); the current question is.
    if (session && spoken === null) setSpoken(initiallySpoken(session.messages))
    const voiceFor = useAgentVoices(room.room_id, messages, spoken, PLAYS_VOICE)
    const current = spoken ? nextToSpeak(messages, spoken) : null
    // Auto response plays the member's own clip: the coach falls silent and its pending lines show in full.
    if (autoPlaying && current && current.status === 'ready' && spoken) setSpoken(new Set([...spoken, ...messages.filter((item) => item.author === 'agent' && item.status === 'ready').map((item) => item.message_id)]))
    const voice = current ? voiceFor(current) : null
    const voiceDriven = voice !== null && voice.state !== 'unavailable' && brokenSpeech !== current?.speech_id
    const activeUrl = voiceDriven && voice?.state === 'ready' ? voice.url : null
    const waitingForVoice = Boolean(current && voiceDriven && startedId !== current.message_id && !blocked)
    const caughtUp = spoken !== null && current === null

    const markSpoken = useCallback((id: string) => setSpoken((set) => set && !set.has(id) ? new Set([...set, id]) : set), [])
    const markTyped = useCallback(() => setTypedId(current?.message_id ?? null), [current?.message_id])

    // Silent lines (no voice, or another seat's frame) move on shortly after their text has typed out.
    useEffect(() => {
        if (!current || current.status !== 'ready' || voiceDriven || typedId !== current.message_id) return
        const timer = setTimeout(() => markSpoken(current.message_id), HOLD_MS)
        return () => clearTimeout(timer)
    }, [current, voiceDriven, typedId, markSpoken])

    useEffect(() => {
        const element = audioRef.current
        if (!element || !activeUrl) return
        element.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
    }, [activeUrl])

    const visibleCount = current ? messages.indexOf(current) + 1 : messages.length
    useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [visibleCount, current?.status, session?.stage, session?.expecting?.step, caughtUp, autoPlaying])

    function showAll() {
        audioRef.current?.pause()
        setPlaying(false)
        setSpoken(new Set(messages.filter((item) => item.author === 'agent').map((item) => item.message_id)))
    }

    const round = session?.round ?? 2
    const examiner = session?.agent.role === 'examiner' || round === 3
    const agentName = session?.agent.label || 'Crisis coach'
    const speaking = playing || Boolean(current && current.status === 'ready' && !voiceDriven && typedId !== current.message_id)
    const stateText = handle.notEligible ? 'Observing' : unavailable ? 'Not available on this server'
        : !session ? (error ? 'Reconnecting…' : 'Connecting to your coach…')
        : current?.status === 'pending' ? 'Thinking…'
        : waitingForVoice ? 'Preparing voice…'
        : speaking ? 'Speaking'
        : session.busy ? (session.stage === 'assessment' ? 'Scoring your answer…' : 'Thinking…')
        : session.stage === 'complete' ? 'Assessment complete'
        : session.expecting ? 'Waiting for your answer'
        : session.stage === 'card' ? (session.card?.status === 'draft' ? 'Review your response card' : 'Recording your response card…')
        : 'Listening'
    const handover = transitionIndex(messages)
    const complete = session?.stage === 'complete' && caughtUp
    const showComposer = Boolean(session?.expecting && caughtUp && !autoPlaying && (session.stage === 'coaching' || session.stage === 'assessment'))
    const lastSource = [...messages].reverse().find((item) => item.author === 'agent' && item.status === 'ready')?.source
    const sourceLabel = lastSource === 'vertex' ? 'Generated live by Gemini (Vertex AI) · voiced by ElevenLabs' : lastSource === 'canonical' ? 'Fixed beta question · voiced by ElevenLabs' : lastSource === 'offline' ? 'Offline reply' : null

    function renderMessage(item: PrivateMessage, index: number) {
        const divider = index === handover && handover > 0 && <li key={`divider-${item.message_id}`} className="private-divider" role="separator"><span>Round 3 · Assessment begins</span><small>Your preparation is complete. The scored challenge begins now: {agentName} is your examiner and only Round 3 answers earn points.</small></li>
        if (item.author === 'member') return [divider, <li key={item.message_id} className="private-message private-message--member"><span className="private-author">{selfName}</span><p>{item.text}</p></li>]
        const isCurrent = item === current
        let body
        if (item.status === 'failed') body = <p className="private-failed">{item.text || 'This reply could not be prepared.'}</p>
        else if (item.status === 'pending') body = <div className="opening-shimmer private-shimmer" aria-busy="true"><span /><span /></div>
        else if (isCurrent && waitingForVoice) body = <p className="private-waiting">Preparing live voice…</p>
        else if (isCurrent && !blocked) body = <p><Typewriter key={item.message_id} text={item.text} onDone={markTyped} /></p>
        else body = <p>{item.text}</p>
        return [divider, <li key={item.message_id} className={`private-message private-message--agent private-message--${item.kind} private-message--r${item.round}${isCurrent ? ' is-current' : ''}`}>
            <span className="private-author">{item.round === 3 ? `${agentName} · examiner` : agentName}</span>
            {body}
        </li>]
    }

    const transcript = <ol className="private-transcript" aria-label="Private conversation">
        {messages.slice(0, visibleCount).flatMap(renderMessage)}
        {autoPlaying && <li className="private-message private-message--member is-live"><span className="private-author">{selfName} · saved answer</span><p>{autoCaption}</p></li>}
    </ol>

    const problem = error || notice

    return <motion.section
        className={`opening-stage private-stage${speaking ? ' is-speaking' : ''}${examiner ? ' is-examiner' : ''}`}
        aria-labelledby="private-title"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
    >
        <div className="opening-meta">
            <h2 id="private-title" className="opening-pill private-pill">{privateRoundLabel(round)}</h2>
            <span className="private-meta-end">
                {round === 3 && session && <span className="private-score" role="status">{scoreText(session.assessment)}</span>}
                {room.game?.phase_deadline && <Countdown key={room.game.phase_id + (room.game.server_time ?? '')} deadline={room.game.phase_deadline} serverTime={room.game.server_time} className="opening-countdown" format={formatClock} />}
            </span>
        </div>
        <div className="private-head">
            <div className="opening-presence">
                <Orb />
                <div className="opening-identity">
                    <span className="opening-name">{agentName}{examiner ? ' · examiner' : ''}</span>
                    <span className="opening-state" role="status">{stateText}</span>
                </div>
            </div>
            <p className="private-lock"><LockIcon />Private: only you and your crisis coach</p>
        </div>
        {round === 3 && session && <ol className="private-chips" aria-label="Assessment stages">
            {stageChips(session.assessment).map((chip) => <li key={chip.step} className={`private-chip private-chip--${chip.status}`}><span>Stage {chip.step}</span><strong>{chip.text}</strong></li>)}
        </ol>}

        {unavailable && <p className="opening-problem" role="alert">{PRIVATE_UNAVAILABLE}</p>}
        {handle.notEligible && <p className="opening-problem" role="status">{PRIVATE_OBSERVER}</p>}
        {handle.notEligible && <PrivateBoard progress={room.game?.private_progress} selfId={room.self_member_id} />}
        {!session && !unavailable && !handle.notEligible && <div className="opening-shimmer" aria-busy="true"><p className="opening-shimmer-label">Opening your private session…</p><span /><span /></div>}

        {complete && session ? <>
            <AssessmentResults assessment={session.assessment} />
            <details className="private-history"><summary>Your private conversation</summary>{transcript}</details>
        </> : session && transcript}

        {session?.retryable && <div className="private-retry" role="alert">
            <p>{agentName} could not respond. Your answers are kept.</p>
            <button type="button" className="opening-play" disabled={sending || session.busy} onClick={() => void handle.retry()}>Retry</button>
        </div>}

        {showComposer && session?.expecting && <AnswerComposer key={expectingKey(session) ?? 'answer'} question={questionText(session)} disabled={sending || session.busy}
            onSubmit={(text) => handle.answer(text, false)} dictation={dictation} attachDictation={attachDictation} />}

        {session?.stage === 'card' && caughtUp && (session.card?.status === 'draft'
            ? <ResponseCardForm key={session.card.fields.action} initial={session.card.fields} disabled={sending || session.busy} onConfirm={handle.confirmCard} />
            : session.card?.status === 'confirmed' ? <p className="private-note" role="status">Response card confirmed. The assessment begins shortly.</p>
            : <div className="opening-shimmer" aria-busy="true"><p className="opening-shimmer-label">{agentName} is recording your response card from your answers…</p><span /><span /></div>)}

        {session?.stage === 'complete' && <PrivateBoard progress={room.game?.private_progress} selfId={room.self_member_id} />}

        {activeUrl && current && <audio key={current.speech_id} ref={audioRef} src={activeUrl}
            onPlay={() => { setPlaying(true); setStartedId(current.message_id) }} onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); markSpoken(current.message_id) }}
            onError={() => { setPlaying(false); setBlocked(false); setBrokenSpeech(current.speech_id) }} />}

        <div className="opening-footer">
            {sourceLabel && <span className={`opening-source${lastSource === 'offline' ? ' is-offline' : ''}`}>{sourceLabel}</span>}
            {blocked && activeUrl && <button type="button" className="opening-play" onClick={() => { void audioRef.current?.play().then(() => setBlocked(false)).catch(() => undefined) }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                Tap to hear
            </button>}
            {blocked && activeUrl && <p className="opening-voice-notice" role="status">The browser blocked autoplay. Tap once to hear your coach.</p>}
            {voice?.state === 'unavailable' && <p className="opening-voice-notice" role="status">{voice.message}</p>}
            {current && current.status === 'ready' && <button type="button" className="opening-link" onClick={showAll}>Show full text</button>}
            {problem && !unavailable && <p className="opening-voice-notice" role="alert">{problem}</p>}
        </div>
        <div ref={endRef} />
    </motion.section>
}
