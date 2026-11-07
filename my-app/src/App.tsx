import { useSyncExternalStore } from 'react'
import './App.css'
import Home from './pages/Home.tsx'
import Host from './pages/Host.tsx'

function subscribeToLocation(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getCurrentLocation() {
  return window.location.hash
}

function App() {
  const location = useSyncExternalStore(subscribeToLocation, getCurrentLocation, () => '')
  return location.split('?')[0] === '#/host' ? <Host key={location} /> : <Home />
}

export default App
