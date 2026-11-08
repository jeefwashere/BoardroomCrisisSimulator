import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { RoomSnapshot, Scenario } from '../../services/rooms'
import { roomApi } from './useRoom'
import { chatTextProblem, createChatStore } from './chatState'
import './RoomChat.css'

type Props = { room: RoomSnapshot; scenarios: Scenario[]; refreshRoom: () => Promise<void> }

export default function RoomChat({ room, scenarios, refreshRoom }: Props) {
    const store = useMemo(() => createChatStore({ api: roomApi, roomId: room.room_id, refreshRoom }), [room.room_id, refreshRoom])
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
    const [open, setOpen] = useState(false)
    useEffect(() => store.start((resume) => {
        const visible = () => { if (document.visibilityState === 'visible') resume() }
        window.addEventListener('focus', resume)
        document.addEventListener('visibilitychange', visible)
        return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', visible) }
    }), [store])
    const scenario = room.game ? scenarios.find((item) => item.scenario_id === room.game?.scenario.scenario_id && item.version === room.game.scenario.version) : scenarios[0]
    const ended = room.phase === 'ended'
    return <aside className={`room-chat ${open ? 'room-chat--open' : ''}`} aria-label="Room conversation">
        <button className="room-chat-toggle" type="button" aria-expanded={open} aria-controls="room-chat-panel" onClick={() => setOpen(!open)}>
            <span>Room chat</span><span>{state.records.length} {state.records.length === 1 ? 'record' : 'records'} {open ? '⌄' : '⌃'}</span>
        </button>
        <div id="room-chat-panel" hidden={!open}>
            <p className="room-chat-note">Shared with everyone in this room. Committed messages remain in the session record.</p>
            <div className="room-chat-history" role="log" aria-label="Committed room records" aria-live="polite" aria-relevant="additions">
                {!state.loaded && !state.historyError && <p role="status">Loading conversation…</p>}
                {state.loaded && state.records.length === 0 && <p className="room-chat-empty">No messages yet. Start the conversation.</p>}
                {state.records.map((entry) => {
                    const member = room.members.find((item) => item.member_id === entry.member_id)
                    const role = scenario?.roles.find((item) => item.role_id === entry.role_id)?.name ?? entry.role_id
                    return <article className="room-chat-record" key={entry.contribution_id} data-contribution-id={entry.contribution_id}>
                        <div className="room-chat-meta"><strong>{member?.display_name ?? 'Room member'}{entry.member_id === room.self_member_id ? ' (you)' : ''}</strong><time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                        <p className="room-chat-context">{role ? `${role} · ` : ''}{entry.phase}{entry.round_number !== null ? ` · Round ${entry.round_number}` : ''}{entry.kind === 'answer' ? ' · Answer' : ''}{entry.source === 'speech' ? ' · Reviewed transcript' : ''}</p>
                        <p className="room-chat-text">{entry.text}</p>
                    </article>
                })}
            </div>
            {state.historyError && <p className="room-chat-error" role="alert">History refresh: {state.historyError} Reconnecting automatically.</p>}
            {ended ? <p className="room-chat-note" role="status">This session has ended. Its committed records remain available.</p> : <form className="room-chat-compose" onSubmit={(event) => { event.preventDefault(); void store.send(room.game?.phase_id ?? null, ended) }}>
                <label htmlFor="room-chat-message">Message everyone</label>
                <textarea id="room-chat-message" rows={3} value={state.draft} disabled={state.sending} onChange={(event) => store.setDraft(event.target.value)} placeholder="Share a thought with the room" />
                <div className="room-chat-compose-actions"><span>{Array.from(state.draft).length.toLocaleString()} / 4,000</span><button type="submit" disabled={state.sending || Boolean(chatTextProblem(state.draft))}>{state.sending ? 'Sending…' : 'Send message'}</button></div>
            </form>}
            {state.error && <p className="room-chat-error" role="alert">{state.error}</p>}
            {state.retry && <div className="room-chat-retry"><p>The server response was not confirmed. Retry checks the same message without adding a duplicate.</p><button type="button" disabled={state.sending} onClick={() => void store.retry()}>Retry original message</button></div>}
        </div>
    </aside>
}
