import type { RoomSnapshot, Scenario } from '../../services/rooms'
import { chatTextProblem } from './chatState'
import type { RoomChatHandle } from './useRoomChat'

/** Committed room history plus the composer. Rendered inside the lobby pill or the game's chat drawer. */
export default function RoomChatPanel({ room, scenarios, chat, compact = false, autoFocus = false }: { room: RoomSnapshot; scenarios: Scenario[]; chat: RoomChatHandle; compact?: boolean; autoFocus?: boolean }) {
    const { store, state } = chat
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
        {ended ? <p className="room-chat-note" role="status">This session has ended. Its committed records remain available.</p> : <form className="room-chat-compose" onSubmit={(event) => { event.preventDefault(); void store.send(room.game?.phase_id ?? null, ended) }}>
            <label htmlFor="room-chat-message" className={compact ? 'room-chat-visually-hidden' : undefined}>Message everyone</label>
            <textarea id="room-chat-message" rows={compact ? 2 : 3} value={state.draft} disabled={state.sending} autoFocus={autoFocus} onChange={(event) => store.setDraft(event.target.value)}
                onKeyDown={(event) => { if (compact && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void store.send(room.game?.phase_id ?? null, ended) } }}
                placeholder={compact ? 'Message everyone (Enter to send)' : 'Share a thought with the room'} />
            <div className="room-chat-compose-actions"><span>{Array.from(state.draft).length.toLocaleString()} / 4,000</span><button type="submit" disabled={state.sending || Boolean(chatTextProblem(state.draft))}>{state.sending ? 'Sending…' : compact ? 'Send' : 'Send message'}</button></div>
        </form>}
        {state.error && <p className="room-chat-error" role="alert">{state.error}</p>}
        {state.retry && <div className="room-chat-retry"><p>The server response was not confirmed. Retry checks the same message without adding a duplicate.</p><button type="button" disabled={state.sending} onClick={() => void store.retry()}>Retry original message</button></div>}
    </>
}
