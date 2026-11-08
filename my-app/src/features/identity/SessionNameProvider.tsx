import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { browserSessionStorage, readSessionName, saveSessionName } from './sessionName'
import { SessionNameContext } from './useSessionName'
import InitialNamePrompt from './InitialNamePrompt'
import './SessionName.css'

function SessionNameProvider({ children }: { children: ReactNode }) {
    const [name, setName] = useState(() => readSessionName(browserSessionStorage()))
    const [isPromptVisible, setIsPromptVisible] = useState(!name)
    const updateName = useCallback((value: string) => {
        setName(saveSessionName(browserSessionStorage(), value))
    }, [])
    const identity = useMemo(() => ({ name, updateName, isMenuReady: !isPromptVisible }), [name, updateName, isPromptVisible])

    return (
        <SessionNameContext.Provider value={identity}>
            {children}
            {isPromptVisible && <InitialNamePrompt onConfirm={updateName} onExited={() => setIsPromptVisible(false)} />}
        </SessionNameContext.Provider>
    )
}

export default SessionNameProvider
