import { useCallback, useEffect, useRef, useState } from 'react'
import { FacilitationError } from '../../services/facilitation'
import type { PrivateSession, ResponseCardFields } from '../../services/facilitation'
import { facilitationApi, facilitationErrorMessage } from '../facilitation/facilitationClient'
import { PRIVATE_POLL_MS, normalizePrivateSession, shouldPollPrivate } from './privateSessionModel'

const RETRY_MS = 3000
const UNAVAILABLE_RETRY_MS = 5000
export const PRIVATE_UNAVAILABLE = 'Private sessions are not available on this server yet. The host can end the private sessions.'
export const PRIVATE_NOT_STARTED = 'private_session_not_started'
export const PRIVATE_NOT_ELIGIBLE = 'not_eligible'
export const QUESTION_TIMED_OUT = 'question_timed_out'
export const PRIVATE_OBSERVER = 'Private sessions are for the board members who wrote a Round 1 decision. You are observing; the board reunites when everyone has finished.'

export type PrivateSessionHandle = {
    session: PrivateSession | null
    /** The route is missing on this server (HTTP 404 or 405 without a server error code). */
    unavailable: boolean
    /** The game ended before this member opened a private session. */
    notStarted: boolean
    /** This member joined late and has no private session (HTTP 403 not_eligible). */
    notEligible: boolean
    error: string
    sending: boolean
    answer: (text: string, usedClip: boolean) => Promise<boolean>
    confirmCard: (fields: ResponseCardFields) => Promise<boolean>
    /** Round 3: the final pick for question `step` ("a" to "d"). */
    choose: (step: number, choiceId: string) => Promise<boolean>
    retry: () => Promise<boolean>
}

/**
 * The caller's own private branch. The first read creates it; reads repeat every 1.2 s while the coach is working
 * and stop while the member is answering. Commands return the updated session, after which polling resumes if needed.
 * A new `refreshKey` (the room phase) reads again, so the ended view shows the final record.
 */
export function usePrivateSession(roomId: string, active: boolean, refreshKey = ''): PrivateSessionHandle {
    const [session, setSession] = useState<PrivateSession | null>(null)
    const [unavailable, setUnavailable] = useState(false)
    const [notStarted, setNotStarted] = useState(false)
    const [notEligible, setNotEligible] = useState(false)
    const [error, setError] = useState('')
    const [sending, setSending] = useState(false)
    // Bumped after each command so the reader restarts (and aborts any older read in flight).
    const [generation, setGeneration] = useState(0)
    const sendingRef = useRef(false)

    useEffect(() => {
        if (!active) return
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        // After the call ends, read the final record once; nothing is retried or polled (no requests after hanging up).
        const ended = refreshKey === 'ended'
        async function read() {
            try {
                const next = normalizePrivateSession(await facilitationApi.privateSession(roomId, controller.signal))
                if (controller.signal.aborted) return
                setUnavailable(false)
                if (!next) { if (ended) return; setError('The private session returned an unexpected response. Retrying…'); timer = setTimeout(() => void read(), RETRY_MS); return }
                setSession(next)
                setError('')
                if (!ended && shouldPollPrivate(next)) timer = setTimeout(() => void read(), PRIVATE_POLL_MS)
            } catch (failure) {
                if (controller.signal.aborted) return
                if (ended) return
                if (failure instanceof FacilitationError && failure.code === PRIVATE_NOT_STARTED) { setNotStarted(true); return }
                if (failure instanceof FacilitationError && failure.code === PRIVATE_NOT_ELIGIBLE) { setNotEligible(true); return }
                if (failure instanceof FacilitationError && !failure.code && (failure.status === 404 || failure.status === 405)) {
                    setUnavailable(true)
                    timer = setTimeout(() => void read(), UNAVAILABLE_RETRY_MS)
                    return
                }
                setError(facilitationErrorMessage(failure, 'The private session is unavailable right now.'))
                timer = setTimeout(() => void read(), RETRY_MS)
            }
        }
        void read()
        return () => { controller.abort(); clearTimeout(timer) }
    }, [roomId, active, generation, refreshKey])

    const send = useCallback(async (request: () => Promise<unknown>): Promise<boolean> => {
        if (sendingRef.current) return false
        sendingRef.current = true
        setSending(true)
        try {
            const next = normalizePrivateSession(await request())
            if (next) setSession(next)
            setError('')
            return true
        } catch (failure) {
            // A pick that lands after the clock ran out: the next read shows the closed question (0 points).
            if (failure instanceof FacilitationError && failure.code === QUESTION_TIMED_OUT) setError('Time ran out for that question before your answer arrived.')
            else setError(facilitationErrorMessage(failure, 'The private session could not be updated. Please try again.'))
            return false
        } finally {
            sendingRef.current = false
            setSending(false)
            setGeneration((value) => value + 1)
        }
    }, [])

    const answer = useCallback((text: string, usedClip: boolean) => send(() => facilitationApi.privateAnswer(roomId, { command_id: crypto.randomUUID(), text, used_clip: usedClip })), [roomId, send])
    const confirmCard = useCallback((fields: ResponseCardFields) => send(() => facilitationApi.privateCard(roomId, { command_id: crypto.randomUUID(), fields })), [roomId, send])
    const choose = useCallback((step: number, choiceId: string) => send(() => facilitationApi.privateChoice(roomId, { command_id: crypto.randomUUID(), step, choice_id: choiceId })), [roomId, send])
    const retry = useCallback(() => send(() => facilitationApi.privateRetry(roomId, { command_id: crypto.randomUUID() })), [roomId, send])

    return { session: active ? session : null, unavailable, notStarted, notEligible, error, sending, answer, confirmCard, choose, retry }
}
