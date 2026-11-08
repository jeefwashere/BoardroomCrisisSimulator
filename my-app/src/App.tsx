import { useCallback, useState, useSyncExternalStore } from 'react'
import './App.css'
import Home from './pages/Home.tsx'
import Host from './pages/Host.tsx'
import Join from './pages/Join.tsx'
import RoomEntry from './features/rooms/RoomEntry'
import SessionNameProvider from './features/identity/SessionNameProvider'
import DemoRoom from './features/demo/DemoRoom'
import SeatNameProvider from './features/demo/SeatNameProvider'
import { seatFromSearch } from './services/tabSession'
import { DEMO_EXIT_MESSAGE } from './features/demo/demoExit'
import type { RoomSnapshot } from './services/rooms'

function subscribeToLocation(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getCurrentLocation() {
  return window.location.hash
}

function App() {
  const location = useSyncExternalStore(subscribeToLocation, getCurrentLocation, () => '')
  const [route, query = ''] = location.split('?')
  const roomId = route.startsWith('#/room/') ? route.slice('#/room/'.length) : ''
  const [admittedRoom, setAdmittedRoom] = useState<RoomSnapshot | null>(null)
  const enterRoom = useCallback((room: RoomSnapshot) => {
    setAdmittedRoom(room)
    window.location.hash = `/room/${room.room_id}`
  }, [])
  // A demo seat frame (`?seat=alex`) holds its own test membership and name.
  const seat = seatFromSearch(window.location.search)
  const leaveDemo = seat && window.parent !== window ? () => {
    window.parent.postMessage({ type: DEMO_EXIT_MESSAGE, roomId, seat }, window.location.origin)
  } : undefined
  if (route === '#/demo' && !seat) return <DemoRoom />
  const page = roomId ? <Host key={roomId} roomId={roomId} showChat={!seat} onLeaveDemo={leaveDemo} initialRoom={admittedRoom?.room_id === roomId ? admittedRoom : undefined} /> : route === '#/host' ? <RoomEntry mode="host" onEnter={enterRoom} /> : route === '#/join' ? <Join key={query} roomCode={new URLSearchParams(query).get('code') ?? ''} onEnter={enterRoom} /> : <Home onEnter={enterRoom} />
  return seat ? <SeatNameProvider seat={seat}>{page}</SeatNameProvider> : <SessionNameProvider>{page}</SessionNameProvider>
}

export default App
