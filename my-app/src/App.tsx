import { useSyncExternalStore } from 'react'
import './App.css'
import Home from './pages/Home.tsx'
import Host from './pages/Host.tsx'
import Join from './pages/Join.tsx'
import RoomEntry from './features/rooms/RoomEntry'
import SessionNameProvider from './features/identity/SessionNameProvider'

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
  return (
    <SessionNameProvider>
      {roomId ? <Host key={roomId} roomId={roomId} /> : route === '#/host' ? <RoomEntry mode="host" /> : route === '#/join' ? <Join roomCode={new URLSearchParams(query).get('code') ?? ''} /> : <Home />}
    </SessionNameProvider>
  )
}

export default App
