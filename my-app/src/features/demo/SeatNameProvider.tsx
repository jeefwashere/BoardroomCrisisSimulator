import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { readSessionName, saveSessionName } from '../identity/sessionName'
import type { NameStorage } from '../identity/sessionName'
import { SessionNameContext } from '../identity/useSessionName'
import { seatStorage } from '../../services/tabSession'
import { DEMO_SEATS } from './demoModel'

function seatNameStorage(seat: string): NameStorage | null {
    try { return seatStorage(window.sessionStorage, seat) } catch { return null }
}

// Demo seat frames share one tab's session storage, so their display names are
// namespaced per seat and the first visit name prompt is skipped.
export default function SeatNameProvider({ seat, children }: { seat: string; children: ReactNode }) {
    const fallback = DEMO_SEATS.find((option) => option.seat === seat)?.name ?? seat
    const [name, setName] = useState(() => readSessionName(seatNameStorage(seat)) || fallback)
    const updateName = useCallback((value: string) => { setName(saveSessionName(seatNameStorage(seat), value)) }, [seat])
    const identity = useMemo(() => ({ name, updateName, isMenuReady: true }), [name, updateName])
    return <SessionNameContext.Provider value={identity}>{children}</SessionNameContext.Provider>
}
