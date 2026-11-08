import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import LobbyIcon from './LobbyIcon'
import './RoomCodeButton.css'

export default function RoomCodeButton({ code, compact = false }: { code: string; compact?: boolean }) {
    const [copied, setCopied] = useState(false)
    const [failed, setFailed] = useState(false)
    const [count, setCount] = useState(0)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const mountedRef = useRef(false)
    const pendingRef = useRef(false)
    const reducedMotion = useReducedMotion() ?? false
    useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false; if (timerRef.current) clearTimeout(timerRef.current) }
    }, [])
    async function copy() {
        if (pendingRef.current) return
        pendingRef.current = true
        try {
            await navigator.clipboard.writeText(code)
            if (!mountedRef.current) return
            if (timerRef.current) clearTimeout(timerRef.current)
            setCopied(true); setFailed(false); setCount((value) => value + 1)
            timerRef.current = setTimeout(() => { setCopied(false); timerRef.current = null }, 3000)
        } catch {
            if (mountedRef.current) { if (timerRef.current) clearTimeout(timerRef.current); setCopied(false); setFailed(true) }
        } finally { pendingRef.current = false }
    }
    return <button className={`${compact ? 'game-room-code' : 'lobby-room-code'}${copied ? ' is-copied' : ''}`} type="button" onClick={() => void copy()} aria-label={copied ? `Room code ${code} copied` : `Copy room code ${code}`} title={failed ? 'Copy failed. Click to try again.' : copied ? 'Copied' : 'Copy room code'}>
        {!compact && <span className="lobby-room-code-label">Room code</span>}
        <span className="room-code-value"><strong>{code}</strong><span className="room-code-feedback" aria-hidden="true"><AnimatePresence mode="wait" initial={false}>
            <motion.span key={copied ? `check-${count}` : 'copy'} initial={reducedMotion ? false : { opacity: 0, scale: 0.45 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.6 }} transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 450, damping: 16, mass: 0.5 }}><LobbyIcon name={copied ? 'check' : 'copy'} /></motion.span>
        </AnimatePresence></span></span>
        <span className="room-code-feedback-status" role="status">{copied ? 'Room code copied.' : failed ? 'Copy failed. Try again.' : ''}</span>
    </button>
}
