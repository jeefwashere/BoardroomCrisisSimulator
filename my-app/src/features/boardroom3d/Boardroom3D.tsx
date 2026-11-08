import { useEffect, useRef, useState } from 'react'
import type { Boardroom, SceneClock } from './Boardroom'
import type { BoardroomView } from './boardroomModel'
import './Boardroom3D.css'

/**
 * The 3D stage. The scene module (three.js with WebGPU) loads on demand, so the 2D call never downloads it.
 * Audio stays with the existing stage hooks; this layer only animates what they report.
 */
export default function Boardroom3D({ active, view, clock }: { active: boolean; view: BoardroomView; clock: SceneClock }) {
    const host = useRef<HTMLDivElement>(null)
    const scene = useRef<Boardroom | null>(null)
    const [progress, setProgress] = useState({ loaded: 0, total: 1 })
    const [failed, setFailed] = useState('')
    const latest = useRef({ view, clock, active })

    useEffect(() => {
        latest.current = { view, clock, active }
        scene.current?.update(view, clock)
    }, [view, clock, active])

    // Hidden (call view): stop rendering but keep everything loaded for an instant switch back.
    useEffect(() => { scene.current?.setActive(active) }, [active])

    useEffect(() => {
        const element = host.current
        if (!element) return
        let disposed = false
        let created: Boardroom | null = null
        import('./Boardroom').then(({ Boardroom }) => {
            if (disposed) return
            created = new Boardroom(element)
            created.onProgress = (loaded, total) => setProgress({ loaded, total })
            created.update(latest.current.view, latest.current.clock)
            created.setActive(latest.current.active)
            scene.current = created
            // Development only: lets a test harness inspect the scene without driving the game.
            if (import.meta.env.DEV) (window as Window & { __board3d?: Boardroom }).__board3d = created
        }).catch((failure: unknown) => setFailed(failure instanceof Error ? failure.message : 'The 3D boardroom could not load.'))
        return () => { disposed = true; created?.dispose(); scene.current = null }
    }, [])

    const loading = progress.loaded < progress.total
    return <div className={`board3d${active ? '' : ' board3d--hidden'}`} aria-hidden={!active} aria-label="3D boardroom: Alex, Morgan and Sam round the table, with the AI agent at the table hub">
        <div ref={host} className="board3d-canvas" />
        {loading && !failed && <p className="board3d-loading" role="status">Loading the boardroom… {progress.total > 1 ? `${progress.loaded} / ${progress.total}` : ''}</p>}
        {failed && <p className="board3d-loading board3d-loading--failed" role="alert">{failed}</p>}
    </div>
}
