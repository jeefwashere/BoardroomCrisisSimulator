import { createContext, useContext, useEffect } from 'react'
import type { StageAgent } from './boardroomModel'

/**
 * The stage components (opening, expert panel, private session) already know when their AI voice is playing.
 * They report it here so the 3D boardroom can light the table hub; without a provider (the 2D call) it is a no op.
 */
export const AgentPresenceContext = createContext<(agent: StageAgent | null) => void>(() => undefined)

/** Report the agent that is talking now (or null). Cleared when the stage unmounts. */
export function useReportAgent(agent: StageAgent | null) {
    const report = useContext(AgentPresenceContext)
    const kind = agent?.kind ?? null
    const name = agent?.name ?? ''
    const role = agent?.role ?? ''
    const accent = agent?.accent ?? null
    useEffect(() => {
        report(kind ? { kind, name, role, accent } : null)
    }, [report, kind, name, role, accent])
    useEffect(() => () => report(null), [report])
}
