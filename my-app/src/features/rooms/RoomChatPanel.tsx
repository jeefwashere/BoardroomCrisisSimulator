import { useEffect, useState } from 'react'
import type { RoomSnapshot, Scenario } from '../../services/rooms'
import { appendTranscript } from '../game/dictationModel'
import { DECISION_LIMIT, DECISION_PROMPT, canSubmitDecision } from '../game/individualDecisionModel'
import { chatTextProblem } from './chatState'
import type { RoomChatHandle } from './useRoomChat'

/** During the Round 1 individual decision the composer can save the member's private decision instead of chatting. */
export type ChatDecision = {
    submit: (text: string) => Promise<boolean>
    pending: boolean
    recorded: string | null
    /** Connects the control bar's Dictate to the decision box; null detaches it. */
    attachDictation?: (sink: ((words: string) => void) | null) => void
}

/** Committed room history plus the composer. Rendered inside the lobby pill or the game's chat drawer. */
export default function RoomChatPanel({ room, scenarios, chat, compact = false, autoFocus = false, decision }: { room: RoomSnapshot; scenarios: Scenario[]; chat: RoomChatHandle; compact?: boolean; autoFocus?: boolean; decision?: ChatDecision }) {
    const { store, state } = chat
    const [target, setTarget] = useState<'decision' | 'room'>('decision')
    const [decisionDraft, setDecisionDraft] = useState('')
    const [decisionError, setDecisionError] = useState('')
    const deciding = Boolean(decision) && target === 'decision'
    const attach = decision?.attachDictation
    useEffect(() => {
        if (!deciding || !attach) return
        attach((words) => setDecisionDraft((current) => appendTranscript(current, words)))
        return () => attach(null)
    }, [deciding, attach])
    const decisionReady = Boolean(decision) && canSubmitDecision(decisionDraft, decision?.recorded) && !decision?.pending
    async function sendDecision() {
        if (!decision || !decisionReady) return
        setDecisionError('')
        if (await decision.submit(decisionDraft.trim())) setDecisionDraft('')
        else setDecisionError('Your decision could not be saved. Please try again.')
    }
    const send = () => { if (deciding) void sendDecision(); else void store.send(room.game?.phase_id ?? null, ended) }
    const scenario = room.game ? scenarios.find((item) => item.scenario_id === room.game?.scenario.scenario_id && item.version === room.game.scenario.version) : scenarios[0]
    const ended = room.phase === 'ended'
    return <>
        {!compact && <p className="room-chat-note">Shared with everyone in this room. Committed messages remain in the session record.</p>}
        <div className="room-chat-history" role="log" aria-label="Committed room records" aria-live="polite" aria-relevant="additions">
            {!state.loaded && !state.historyError && <p role="status">Loading conversation…</p>}
            {state.loaded && state.records.length === 0 && <p className="room-chat-empty">No messages yet. Start the conversation.</p>}
            {state.records.map((entry) => {
                const member = room.members.find((item) => item.member_id === entry.member_id)
                const role = scenario?.roles.find((item) => item.role_id === entry.role_id)?.name ?? entry.role_id
                return <article className={`room-chat-record${entry.member_id === room.self_member_id ? ' is-self' : ''}`} key={entry.contribution_id} data-contribution-id={entry.contribution_id}>
                    <div className="room-chat-meta"><strong>{member?.display_name ?? 'Room member'}{entry.member_id === room.self_member_id ? ' (you)' : ''}</strong><time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                    <p className="room-chat-context">{role ? `${role} · ` : ''}{entry.phase}{entry.round_number !== null ? ` · Round ${entry.round_number}` : ''}{entry.kind === 'answer' ? ' · Answer' : ''}{entry.source === 'speech' ? ' · Reviewed transcript' : ''}</p>
                    <p className="room-chat-text">{entry.text}</p>
                </article>
            })}
        </div>
        {state.historyError && <p className="room-chat-error" role="alert">History refresh: {state.historyError} Reconnecting automatically.</p>}
        {ended ? <p className="room-chat-note" role="status">This session has ended. Its committed records remain available.</p> : <form className={`room-chat-compose${deciding ? ' is-decision' : ''}`} onSubmit={(event) => { event.preventDefault(); send() }}>
            {decision && <div className="room-chat-target" role="radiogroup" aria-label="Send to">
                <button type="button" role="radio" aria-checked={deciding} className={deciding ? 'is-active' : ''} onClick={() => setTarget('decision')}>Your decision</button>
                <button type="button" role="radio" aria-checked={!deciding} className={!deciding ? 'is-active' : ''} onClick={() => setTarget('room')}>Message everyone</button>
            </div>}
            <label htmlFor="room-chat-message" className={compact ? 'room-chat-visually-hidden' : undefined}>{deciding ? 'Your private decision' : 'Message everyone'}</label>
            <textarea id="room-chat-message" rows={compact ? (deciding ? 4 : 2) : 3} maxLength={deciding ? DECISION_LIMIT : undefined}
                value={deciding ? decisionDraft : state.draft} disabled={deciding ? decision?.pending : state.sending} autoFocus={autoFocus}
                onChange={(event) => { if (deciding) setDecisionDraft(event.target.value); else store.setDraft(event.target.value) }}
                onKeyDown={(event) => { if (compact && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }}
                placeholder={deciding ? `${DECISION_PROMPT} (Enter to submit; only you see it)` : compact ? 'Message everyone (Enter to send)' : 'Share a thought with the room'} />
            {deciding
                ? <div className="room-chat-compose-actions"><span>{decision?.recorded ? 'Sending again replaces your decision' : 'Only you see your decision'}</span><button type="submit" disabled={!decisionReady}>{decision?.pending ? 'Saving…' : decision?.recorded ? 'Replace decision' : 'Submit decision'}</button></div>
                : <div className="room-chat-compose-actions"><span>{Array.from(state.draft).length.toLocaleString()} / 4,000</span><button type="submit" disabled={state.sending || Boolean(chatTextProblem(state.draft))}>{state.sending ? 'Sending…' : compact ? 'Send' : 'Send message'}</button></div>}
        </form>}
        {deciding && decisionError && <p className="room-chat-error" role="alert">{decisionError}</p>}
        {state.error && <p className="room-chat-error" role="alert">{state.error}</p>}
        {state.retry && <div className="room-chat-retry"><p>The server response was not confirmed. Retry checks the same message without adding a duplicate.</p><button type="button" disabled={state.sending} onClick={() => void store.retry()}>Retry original message</button></div>}
    </>
}
