import { useSyncExternalStore } from 'react'
import './App.css'
import Home from './pages/Home.tsx'
import Host from './pages/Host.tsx'
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
  return (
    <SessionNameProvider>
      {location.split('?')[0] === '#/host' ? <Host key={location} /> : <Home />}
    </SessionNameProvider>
  )
}

export default App
