import { createContext, useContext } from 'react'

type SessionNameValue = {
    name: string
    isMenuReady: boolean
    updateName: (name: string) => void
}

export const SessionNameContext = createContext<SessionNameValue | null>(null)

export function useSessionName(): SessionNameValue {
    const identity = useContext(SessionNameContext)
    if (!identity) throw new Error('Session name components must be inside SessionNameProvider.')
    return identity
}
