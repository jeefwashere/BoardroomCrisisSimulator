import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { LobbyMember } from '../features/lobby/lobbyModel'
import LobbyIcon from '../features/lobby/LobbyIcon'
import { playerRoleLabel } from '../features/game/playerPresentation'
import { buildSummaryCards, summaryEmailError } from '../features/summary/summaryModel'
import type { RoomSummaryResponse } from '../features/summary/summaryModel'
import { fetchRoomSummary, requestSummaryEmail } from '../services/summaries'
import './Summary.css'

type SummaryProps = {
    members: LobbyMember[]
    roomCode: string
    onBackToCall: () => void
}

function Summary({ members, roomCode, onBackToCall }: SummaryProps) {
    const [response, setResponse] = useState<RoomSummaryResponse | null>(null)
    const [loadError, setLoadError] = useState('')
    const [loading, setLoading] = useState(true)
    const [attempt, setAttempt] = useState(0)
    const [email, setEmail] = useState('')
    const [emailError, setEmailError] = useState('')
    const [emailNotice, setEmailNotice] = useState('')
    const [sending, setSending] = useState(false)
    const emailRequest = useRef<AbortController | null>(null)
    const cards = buildSummaryCards(members, response)
    const pendingCount = cards.filter((card) => !card.summary).length

    useEffect(() => {
        const controller = new AbortController()
        void fetchRoomSummary(roomCode, controller.signal).then((result) => {
            if (!controller.signal.aborted) setResponse(result)
        }).catch((error: unknown) => {
            if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Summaries could not be loaded.')
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })
        return () => controller.abort()
    }, [roomCode, attempt])

    useEffect(() => () => emailRequest.current?.abort(), [])

    function refreshSummaries() {
        setLoading(true)
        setLoadError('')
        setAttempt((current) => current + 1)
    }

    async function submitEmail(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (emailRequest.current) return
        const error = summaryEmailError(email)
        setEmailError(error ?? '')
        setEmailNotice('')
        if (error) return
        const controller = new AbortController()
        emailRequest.current = controller
        setSending(true)
        try {
            const receipt = await requestSummaryEmail(roomCode, email, controller.signal)
            if (!controller.signal.aborted) setEmailNotice(`${receipt.recipient}: ${receipt.message}`)
        } catch (error) {
            if (!controller.signal.aborted) setEmailError(error instanceof Error ? error.message : 'The email request could not be completed.')
        } finally {
            if (!controller.signal.aborted) {
                emailRequest.current = null
                setSending(false)
            }
        }
    }

    return (
        <div className="summary-screen">
            <header className="summary-toolbar">
                <button className="summary-back" type="button" onClick={onBackToCall}><LobbyIcon name="back" />Back to room</button>
                <span className="summary-room-code">Room <strong>{roomCode}</strong></span>
            </header>

            <section className="summary-heading" aria-labelledby="summary-title">
                <span className="summary-eyebrow">Demo preview</span>
                <h1 id="summary-title">Session summary preview</h1>
                <p className="summary-preview-notice">Demonstration only. Participant summaries are pending. This preview does not generate AI evaluation, process uploaded documents, or send email. Return to the room for actual game records, audio and evaluation.</p>
                <div className="summary-load-status">
                    <p role="status">{loading ? 'Loading summaries…' : loadError || (pendingCount ? 'Preview: participant summaries pending.' : `${cards.length} participant summaries.`)}</p>
                    {!loading && <button type="button" onClick={refreshSummaries}>{loadError ? 'Try again' : 'Refresh'}</button>}
                </div>
            </section>

            <main className="summary-list" tabIndex={0} aria-label="Participant summaries">
                {cards.map((card) => (
                    <article className="summary-card" key={card.id} aria-labelledby={`summary-name-${card.id}`}>
                        <div className="summary-card-identity">
                            <h2 id={`summary-name-${card.id}`}>{card.name}</h2>
                            <span>{playerRoleLabel(card.role)}{card.isHost && <span className="summary-host"><LobbyIcon name="crown" />Host</span>}</span>
                        </div>
                        <p className={card.summary ? 'summary-card-text' : 'summary-card-text is-pending'}>{card.summary || 'Summary not available yet.'}</p>
                    </article>
                ))}
                {cards.length === 0 && <p className="summary-empty">No participants in this call.</p>}
            </main>

            <footer className="summary-email">
                <form onSubmit={(event) => void submitEmail(event)} noValidate>
                    <label htmlFor="summary-email">Preview an email request</label>
                    <div className="summary-email-controls">
                        <input id="summary-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} disabled={sending} required maxLength={254} aria-invalid={Boolean(emailError)} aria-describedby="summary-email-message" onChange={(event) => { setEmail(event.target.value); setEmailError(''); setEmailNotice('') }} />
                        <button type="submit" disabled={sending}>{sending ? 'Requesting…' : 'Preview email request'}<span aria-hidden="true">↗</span></button>
                    </div>
                    <p id="summary-email-message" className={emailError ? 'summary-email-message is-error' : 'summary-email-message'} role="status">{emailError || emailNotice || 'Preview only. No email will be sent.'}</p>
                </form>
            </footer>
        </div>
    )
}

export default Summary
