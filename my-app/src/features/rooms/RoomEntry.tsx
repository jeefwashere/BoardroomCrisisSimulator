import Home from '../../pages/Home'
import type { RoomSnapshot } from '../../services/rooms'
import type { EntryMode } from './directEntry'

// Keep existing host and invitation URLs working through the main menu.
export default function RoomEntry({ mode, initialCode = '', onEnter }: { mode: EntryMode; initialCode?: string; onEnter: (room: RoomSnapshot) => void }) {
    return <Home key={`${mode}:${initialCode}`} initialEntry={mode} initialCode={initialCode} onEnter={onEnter} />
}
