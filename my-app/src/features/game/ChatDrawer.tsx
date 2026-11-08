import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { RoomSnapshot, Scenario } from '../../services/rooms'
import RoomChatPanel from '../rooms/RoomChatPanel'
import type { RoomChatHandle } from '../rooms/useRoomChat'
import '../rooms/RoomChat.css'

/** Right side chat drawer opened from the control bar. Escape closes it. */
export default function ChatDrawer({ room, scenarios, chat, open, onClose, pinned }: { room: RoomSnapshot; scenarios: Scenario[]; chat: RoomChatHandle; open: boolean; onClose: () => void; pinned?: ReactNode }) {
    useEffect(() => {
        if (!open) return
        const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', close)
        return () => window.removeEventListener('keydown', close)
    }, [open, onClose])
    return <aside id="game-chat-drawer" className={`chat-drawer${open ? ' is-open' : ''}`} aria-label="Room chat" aria-hidden={!open} inert={!open}>
        <header className="chat-drawer-header">
            <h2>Room chat</h2>
            <button type="button" className="chat-drawer-close" aria-label="Close chat" onClick={onClose}>×</button>
        </header>
        <div className="chat-drawer-body">{pinned && <div className="chat-drawer-pinned">{pinned}</div>}{open && <RoomChatPanel room={room} scenarios={scenarios} chat={chat} compact autoFocus={!pinned} />}</div>
    </aside>
}
