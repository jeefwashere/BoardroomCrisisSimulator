import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// No StrictMode: its double effect run would dispose the game client and the WebGL scene.
createRoot(document.getElementById('root')!).render(<App />)
