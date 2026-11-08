import RoomEntry from '../features/rooms/RoomEntry'
import type { RoomSnapshot } from '../services/rooms'

export default function Join({ roomCode, onEnter }: { roomCode: string; onEnter: (room: RoomSnapshot) => void }) {
    return <RoomEntry mode="join" initialCode={roomCode} onEnter={onEnter} />
}
