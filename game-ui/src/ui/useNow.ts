import { useEffect, useState } from 'react'

/** Current time, refreshed a few times a second for countdowns. */
export function useNow(interval = 250) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(id)
  }, [interval])
  return now
}

export function remaining(deadline: number | null | undefined, now: number) {
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null
}

export function clock(seconds: number | null) {
  if (seconds === null) return '--:--'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
