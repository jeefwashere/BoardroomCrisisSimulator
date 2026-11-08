import { useState } from 'react'
import type { RoomSnapshot, Scenario } from '../../services/rooms'
import RoomChatPanel from './RoomChatPanel'
import type { RoomChatHandle } from './useRoomChat'
import './RoomChat.css'

/** Floating lobby chat pill. In the game the same history opens from the bottom control bar instead. */
export default function RoomChat({ room, scenarios, chat }: { room: RoomSnapshot; scenarios: Scenario[]; chat: RoomChatHandle }) {
    const [open, setOpen] = useState(false)
    const count = chat.state.records.length
    return <aside className={`room-chat ${open ? 'room-chat--open' : ''}`} aria-label="Room conversation">
        <button className="room-chat-toggle" type="button" aria-expanded={open} aria-controls="room-chat-panel" onClick={() => setOpen(!open)}>
            <span>Room chat</span><span>{count} {count === 1 ? 'record' : 'records'} {open ? '⌄' : '⌃'}</span>
        </button>
        <div id="room-chat-panel" hidden={!open}><RoomChatPanel room={room} scenarios={scenarios} chat={chat} /></div>
    </aside>
}
