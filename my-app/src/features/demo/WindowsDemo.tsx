import { useEffect, useState } from 'react'
import { RoomApiError } from '../../services/rooms'
import type { RoomSnapshot } from '../../services/rooms'
import { roomApi } from '../rooms/useRoom'
import { startInput } from '../rooms/roomState'
import { JOIN_SEATS, demoRoles, isLoopbackOrigin, joinLink, pickDemoScenario, windowSeats } from './demoModel'
import type { DemoView, StoredDemo } from './demoModel'

const GONE = new Set(['room_not_found', 'room_closed', 'not_a_member', 'session_required'])

function message(failure: unknown): string {
    return failure instanceof Error ? failure.message : 'The request failed. Please retry.'
}

/**
 * Three window demo, Alex's side: this window is Alex (host, ordinary membership). Morgan and Sam open their join
 * links in their own windows or on other devices; nothing is automated. Alex starts T01 once both have joined, then
 * this window becomes Alex's game screen.
 */
export default function WindowsDemo({ demo, view, onReset }: { demo: StoredDemo; view: DemoView; onReset: (notice?: string) => void }) {
    const [room, setRoom] = useState<RoomSnapshot | null>(null)
    const [error, setError] = useState('')
    const [starting, setStarting] = useState(false)
    const [copied, setCopied] = useState('')

    useEffect(() => {
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        async function tick() {
            try {
                const next = await roomApi.snapshot(demo.room_id, controller.signal)
                if (controller.signal.aborted) return
                setRoom(next)
                setError('')
                // Started (here or from another tab): continue as Alex in the game screen.
                if (next.phase !== 'lobby') { window.location.hash = `/room/${demo.room_id}`; return }
            } catch (failure) {
                if (controller.signal.aborted) return
                if (failure instanceof RoomApiError && GONE.has(failure.code)) {
                    onReset('The previous room is gone (usually a backend restart). Create a new one below.')
                    return
                }
                setError(message(failure))
            }
            timer = setTimeout(() => void tick(), 1500)
        }
        void tick()
        return () => { controller.abort(); clearTimeout(timer) }
    }, [demo.room_id, onReset])

    const seats = room ? windowSeats(room) : { alex: null, morgan: null, sam: null }
    const ready = Boolean(seats.alex && seats.morgan && seats.sam)
    const origin = window.location.origin
    const local = isLoopbackOrigin(origin)

    async function start() {
        if (!room || !ready || starting) return
        setStarting(true)
        setError('')
        try {
            const scenario = pickDemoScenario(await roomApi.scenarios())
            const timing = scenario?.timings[0]?.profile_id
            if (!scenario || !timing) throw new Error('No scenario with a timing profile is available.')
            const latest = await roomApi.snapshot(room.room_id)
            const order = [seats.alex!, seats.morgan!, seats.sam!]
            const body = { ...startInput(latest, scenario, timing, demoRoles(latest, order, scenario), crypto.randomUUID()), ballot_source: demo.ballot ?? 'authored', manual_turns: true }
            await roomApi.start(room.room_id, body)
            window.location.hash = `/room/${room.room_id}`
        } catch (failure) {
            setError(`Start failed: ${message(failure)}`)
            setStarting(false)
        }
    }

    async function copy(text: string, key: string) {
        try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1800) } catch { setCopied('') }
    }

    return <main className="demo-setup">
        <section className="demo-setup__card" aria-labelledby="windows-title">
            <p className="demo-eyebrow">Three window test · Room {demo.room_code}</p>
            <h1 id="windows-title">Waiting for Morgan and Sam</h1>
            <p className="demo-lede">This window is <strong>Alex, the CEO and host</strong>. Open each link below in its own window, browser profile or device. Every player takes their own turns; nothing is automated.</p>
            {local && <p className="demo-error" role="note">This page is open on a local address, so these links only work on this computer. For other devices, open the game through the public ngrok address (see <code>docs/ngrok-demo.md</code>).</p>}
            <ul className="demo-joins">
                <li className={`demo-join${seats.alex ? ' is-joined' : ''}`}>
                    <div><strong>Alex</strong><span>CEO · this window</span></div>
                    <span className="demo-join__state">Host</span>
                </li>
                {JOIN_SEATS.map((seat) => {
                    const link = joinLink(origin, window.location.pathname, demo.room_code, seat.seat, view)
                    const joined = Boolean(seats[seat.seat])
                    return <li key={seat.seat} className={`demo-join${joined ? ' is-joined' : ''}`}>
                        <div><strong>{seat.name}</strong><span>{seat.role}</span><code className="demo-join__link">{link}</code></div>
                        <div className="demo-join__actions">
                            <span className="demo-join__state" role="status">{joined ? 'Joined' : 'Waiting…'}</span>
                            {!joined && <>
                                <button type="button" className="demo-secondary demo-secondary--small" onClick={() => void copy(link, seat.seat)}>{copied === seat.seat ? 'Copied' : 'Copy link'}</button>
                                <a className="demo-secondary demo-secondary--small" href={link} target="_blank" rel="noopener noreferrer">Open</a>
                            </>}
                        </div>
                    </li>
                })}
            </ul>
            <p className="demo-note">Others can also join from the home page with room code <strong>{demo.room_code}</strong>, using the name Morgan or Sam.</p>
            <div className="demo-actions">
                <button className="demo-primary" type="button" disabled={!ready || starting} aria-busy={starting} onClick={() => void start()}>{starting ? 'Starting…' : ready ? 'Start the game' : 'Start (waiting for both players)'}</button>
                <button className="demo-secondary" type="button" onClick={() => onReset()}>Reset demo</button>
            </div>
            {error && <p className="demo-error" role="alert">{error}</p>}
        </section>
    </main>
}
