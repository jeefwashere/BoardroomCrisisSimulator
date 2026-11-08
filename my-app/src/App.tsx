import { useCallback, useState, useSyncExternalStore } from 'react'
import './App.css'
import Home from './pages/Home.tsx'
import Host from './pages/Host.tsx'
import Join from './pages/Join.tsx'
import RoomEntry from './features/rooms/RoomEntry'
import SessionNameProvider from './features/identity/SessionNameProvider'
import DemoRoom from './features/demo/DemoRoom'
import SeatNameProvider from './features/demo/SeatNameProvider'
import DemoJoin from './features/demo/DemoJoin'
import { readJoinRequest } from './features/demo/demoModel'
import { browserSessionStorage, saveSessionName } from './features/identity/sessionName'
import { seatFromSearch } from './services/tabSession'
import type { RoomSnapshot } from './services/rooms'

function subscribeToLocation(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getCurrentLocation() {
  return window.location.hash
}

/** A three window demo join link names its own player, so the first visit name prompt is skipped. */
function DemoJoinRoute({ query, onEnter }: { query: string; onEnter: (room: RoomSnapshot) => void }) {
  useState(() => { const request = readJoinRequest(query); if (request) saveSessionName(browserSessionStorage(), request.name); return true })
  return <SessionNameProvider><DemoJoin query={query} onEnter={onEnter} /></SessionNameProvider>
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
  if (route === '#/demo' && !seat) return <DemoRoom />
  if (route === '#/demo/join' && !seat) return <DemoJoinRoute query={query} onEnter={enterRoom} />
  const page = roomId ? <Host key={roomId} roomId={roomId} initialRoom={admittedRoom?.room_id === roomId ? admittedRoom : undefined} /> : route === '#/host' ? <RoomEntry mode="host" onEnter={enterRoom} /> : route === '#/join' ? <Join key={query} roomCode={new URLSearchParams(query).get('code') ?? ''} onEnter={enterRoom} /> : <Home onEnter={enterRoom} />
  return seat ? <SeatNameProvider seat={seat}>{page}</SeatNameProvider> : <SessionNameProvider>{page}</SessionNameProvider>
}

export default App
