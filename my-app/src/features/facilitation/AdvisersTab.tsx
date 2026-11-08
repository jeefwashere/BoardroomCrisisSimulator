import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { AdviserKind, Consultation, Facilitation } from '../../services/facilitation'
import type { RoomSnapshot } from '../../services/rooms'
import { facilitationApi, facilitationErrorMessage } from './facilitationClient'
import {
    ADVISER_ACCENTS, SUGGESTED_QUESTIONS, adviserInitials, askAvailability, askerName, hasOwnPending,
    mergeConsultation, orderConsultations, replySourceLabel,
} from './facilitationModel'
import { PlayIcon } from './ClipRow'
import type { SharedAudioState } from './useSharedAudio'

const POLL_MS = 2000

type SpeechNote = { loading: boolean; message: string }

function AdviserAvatar({ kind, label, small = false }: { kind: AdviserKind; label: string; small?: boolean }) {
    return <span className={`facilitation-avatar${small ? ' facilitation-avatar--small' : ''}`} style={{ background: ADVISER_ACCENTS[kind] ?? '#5b5f57' }} aria-hidden="true">{adviserInitials(label)}</span>
}

function formatTime(at: string): string {
    const time = Date.parse(at)
    return Number.isFinite(time) ? new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
}

export default function AdvisersTab({ room, player, onToggle, review = false }: { room: RoomSnapshot; player: SharedAudioState; onToggle: (key: string, src: string) => void; review?: boolean }) {
    const [state, setState] = useState<Facilitation | null>(null)
    const [loadError, setLoadError] = useState('')
    const [retryToken, setRetryToken] = useState(0)
    const [selected, setSelected] = useState<AdviserKind>('facilitator')
    const [question, setQuestion] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [askError, setAskError] = useState('')
    const [speechNotes, setSpeechNotes] = useState<Record<string, SpeechNote>>({})
    const speechUrls = useRef(new Map<string, string>())
    const roomId = room.room_id

    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        async function poll() {
            try {
                const incoming = await facilitationApi.state(roomId, controller.signal)
                if (controller.signal.aborted) return
                setState(incoming)
                setLoadError('')
            } catch (failure) {
                if (controller.signal.aborted) return
                setLoadError(facilitationErrorMessage(failure, 'Advisers are unavailable right now.'))
            }
            if (!controller.signal.aborted) timer = setTimeout(() => void poll(), POLL_MS)
        }
        void poll()
        return () => { controller.abort(); clearTimeout(timer) }
    }, [roomId, retryToken])

    useEffect(() => {
        const urls = speechUrls.current
        return () => { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear() }
    }, [])

    const advisers = useMemo(() => state?.advisers ?? [], [state])
    const consultations = useMemo(() => orderConsultations(state?.consultations ?? []), [state])
    const labels = useMemo(() => new Map(advisers.map((adviser) => [adviser.kind, adviser.label])), [advisers])
    const ownPending = hasOwnPending(consultations, room.self_member_id)
    const availability = askAvailability(room.phase, ownPending, submitting)
    const current = advisers.find((adviser) => adviser.kind === selected) ?? advisers[0]
    const currentKind = current?.kind ?? selected

    async function ask(event: FormEvent) {
        event.preventDefault()
        const text = question.trim()
        if (!text || availability.blocked || !current) return
        setSubmitting(true)
        setAskError('')
        try {
            const created = await facilitationApi.consult(roomId, current.kind, text)
            setQuestion('')
            setState((previous) => previous ? { ...previous, consultations: mergeConsultation(previous.consultations, created) } : previous)
        } catch (failure) {
            setAskError(facilitationErrorMessage(failure, 'Your question could not be sent. Please try again.'))
        } finally {
            setSubmitting(false)
        }
    }

    const listen = useCallback(async (consultation: Consultation) => {
        const speechId = consultation.speech_id
        if (!speechId) return
        const key = `speech:${speechId}`
        const cached = speechUrls.current.get(speechId)
        if (cached) { onToggle(key, cached); return }
        const note = (value: SpeechNote) => setSpeechNotes((notes) => ({ ...notes, [speechId]: value }))
        note({ loading: true, message: '' })
        try {
            const status = await facilitationApi.prepareSpeech(roomId, speechId)
            if (status.status === 'disabled') { note({ loading: false, message: 'Spoken replies are turned off for this meeting. The reply stays readable here.' }); return }
            if (status.status === 'pending') { note({ loading: false, message: 'The spoken reply is still being prepared. Try Listen again in a moment.' }); return }
            if (status.status === 'failed') { note({ loading: false, message: status.error || 'Speech could not be prepared. The reply stays readable here.' }); return }
            const blob = await facilitationApi.speechAudio(roomId, speechId)
            const url = URL.createObjectURL(blob)
            speechUrls.current.set(speechId, url)
            note({ loading: false, message: '' })
            onToggle(key, url)
        } catch (failure) {
            note({ loading: false, message: facilitationErrorMessage(failure, 'Speech is unavailable. The reply stays readable here.') })
        }
    }, [roomId, onToggle])

    return <div className="facilitation-advisers">
        <p className="facilitation-disclaimer"><strong>Advisory only.</strong> AI facilitators suggest and question. They cannot vote, pass a turn or change a decision.</p>

        {loadError && <div className="facilitation-error" role="alert">
            <span>{loadError}</span>
            <button type="button" className="facilitation-secondary" onClick={() => setRetryToken((token) => token + 1)}>Retry</button>
        </div>}

        {!state && !loadError && <p className="facilitation-loading" role="status"><span className="facilitation-spinner" aria-hidden="true" /> Loading advisers…</p>}

        {review && <div className="facilitation-summary-cards">{advisers.map((adviser) => {
            const replies = consultations.filter((item) => item.kind === adviser.kind && (room.phase === 'ended' || item.round_number === room.game?.round_number))
            return <article key={adviser.kind} className="facilitation-summary-card"><header><AdviserAvatar kind={adviser.kind} label={adviser.label} /><div><h3>{adviser.label}</h3><p>{adviser.description}</p></div></header>
                {adviser.kind === 'facilitator' && state?.opening?.text && <details><summary>Opening briefing</summary><p>{state.opening.text}</p></details>}
                {replies.length === 0 && <p className="facilitation-empty">No summary is available for this {room.phase === 'ended' ? 'session' : 'round'} yet.</p>}
                {replies.map((reply) => <div className="facilitation-summary-reply" key={reply.consultation_id}><span className="facilitation-note">{reply.question}</span><p>{reply.status === 'ready' ? reply.reply : reply.status === 'pending' ? 'Preparing a reply…' : reply.error || 'No reply available.'}</p></div>)}
            </article>
        })}</div>}
        {!review && advisers.length > 0 && <div className="facilitation-adviser-list" role="radiogroup" aria-label="Choose an adviser">
            {advisers.map((adviser) => <button key={adviser.kind} type="button" role="radio" aria-checked={adviser.kind === currentKind}
                className={`facilitation-adviser${adviser.kind === currentKind ? ' is-selected' : ''}`} onClick={() => setSelected(adviser.kind)}>
                <AdviserAvatar kind={adviser.kind} label={adviser.label} />
                <span className="facilitation-adviser-text">
                    <strong>{adviser.label}</strong>
                    <span>{adviser.description}</span>
                </span>
            </button>)}
        </div>}

        {!review && current && <form className="facilitation-ask" onSubmit={(event) => void ask(event)}>
            <label htmlFor={`facilitation-question-${roomId}`}>Ask the {current.label}</label>
            <div className="facilitation-suggestions" aria-label="Suggested questions">
                {(SUGGESTED_QUESTIONS[current.kind] ?? []).map((suggestion) => <button key={suggestion} type="button" className="facilitation-chip" onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}
            </div>
            <textarea id={`facilitation-question-${roomId}`} value={question} maxLength={1000} rows={3} placeholder="Type a question for the adviser"
                disabled={room.phase === 'ended' || room.phase === 'lobby'} onChange={(event) => setQuestion(event.target.value)} />
            <div className="facilitation-ask-row">
                <span className="facilitation-note" role="status">{availability.reason}</span>
                <button type="submit" className="facilitation-primary" disabled={availability.blocked || !question.trim()}>{submitting ? 'Asking…' : 'Ask'}</button>
            </div>
            {askError && <p className="facilitation-note facilitation-note--error" role="alert">{askError}</p>}
        </form>}

        {!review && <section className="facilitation-feed" aria-labelledby={`facilitation-feed-${roomId}`}>
            <h3 id={`facilitation-feed-${roomId}`}>Room consultations <span>{consultations.length}</span></h3>
            {state && consultations.length === 0 && <p className="facilitation-empty">No questions yet. Everything asked here is shared with the whole room.</p>}
            <ol>
                {consultations.map((item) => {
                    const label = labels.get(item.kind) ?? item.kind
                    const note = item.speech_id ? speechNotes[item.speech_id] : undefined
                    const speechKey = item.speech_id ? `speech:${item.speech_id}` : ''
                    const playing = speechKey !== '' && player.key === speechKey && player.playing
                    return <li key={item.consultation_id} className={`facilitation-entry facilitation-entry--${item.status}`}>
                        <header>
                            <AdviserAvatar kind={item.kind} label={label} small />
                            <span><strong>{askerName(room.members, item.member_id, room.self_member_id)}</strong> asked the {label}</span>
                            <time dateTime={item.at}>{item.round_number ? `Round ${item.round_number} · ` : ''}{formatTime(item.at)}</time>
                        </header>
                        <blockquote>{item.question}</blockquote>
                        {item.status === 'pending' && <p className="facilitation-pending" role="status"><span className="facilitation-spinner" aria-hidden="true" /> {label} is preparing a reply…</p>}
                        {item.status === 'failed' && <p className="facilitation-note facilitation-note--error">No reply: {item.error || 'the adviser could not answer this time.'}</p>}
                        {item.status === 'ready' && <div className="facilitation-reply">
                            <div className="facilitation-reply-meta">
                                {replySourceLabel(item.source) && <span className={`facilitation-badge facilitation-badge--${item.source}`}>{replySourceLabel(item.source)}</span>}
                                {item.speech_id && <button type="button" className="facilitation-listen" aria-pressed={playing} disabled={note?.loading} onClick={() => void listen(item)}>
                                    {note?.loading ? <span className="facilitation-spinner" aria-hidden="true" /> : <PlayIcon playing={playing} />}
                                    {note?.loading ? 'Preparing…' : playing ? 'Pause' : 'Listen'}
                                </button>}
                            </div>
                            <p>{item.reply}</p>
                            {note?.message && <p className="facilitation-note">{note.message}</p>}
                            {speechKey && player.key === speechKey && player.error && <p className="facilitation-note facilitation-note--error">{player.error}</p>}
                        </div>}
                    </li>
                })}
            </ol>
        </section>}
    </div>
}
