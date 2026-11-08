import { useEffect, useState } from 'react'

/** Seconds left until the server deadline, corrected for the snapshot's server clock. */
export default function Countdown({ deadline, serverTime, className = 'game-countdown', format = (seconds) => `${seconds}s remaining` }: { deadline?: string | null; serverTime?: string; className?: string; format?: (seconds: number) => string }) {
    const [elapsed, setElapsed] = useState(0)
    useEffect(() => { const started = performance.now(); const timer = setInterval(() => setElapsed(performance.now() - started), 200); return () => clearInterval(timer) }, [deadline, serverTime])
    const remaining = deadline && serverTime ? Math.max(0, Math.ceil((Date.parse(deadline) - Date.parse(serverTime) - elapsed) / 1000)) : null
    return remaining === null ? null : <span className={className} aria-label={`${remaining} seconds remaining`}>{format(remaining)}</span>
}
