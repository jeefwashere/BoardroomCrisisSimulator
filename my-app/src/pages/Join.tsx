import RoomEntry from '../features/rooms/RoomEntry'

export default function Join({ roomCode }: { roomCode: string }) {
    return <RoomEntry mode="join" initialCode={roomCode} />
}
