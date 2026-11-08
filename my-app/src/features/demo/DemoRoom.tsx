import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoomApi, RoomApiError } from '../../services/rooms'
import type { RoomApi, RoomSnapshot, Scenario } from '../../services/rooms'
import { clearSeatSession, createTabSession, seatStorage } from '../../services/tabSession'
import type { StoragePort } from '../../services/tabSession'
import { acceptSnapshot, startInput } from '../rooms/roomState'
import { DEFAULT_DEMO_MODE, DEMO_SEATS, DEMO_STORAGE_KEY, DEMO_VIEW_KEY, SPLIT_VIEW_MIN_WIDTH, demoRoles, demoRoomCode, followTarget, phaseLabel, pickDemoScenario, readDemoView, readStoredDemo, seatStatus, soloFrameSrc } from './demoModel'
import type { BallotSource, DemoMode, DemoView, StoredDemo } from './demoModel'
import { useSoloBots } from './useSoloBots'
import WindowsDemo from './WindowsDemo'
import DemoSetup from './DemoSetup'
import { roomApi } from '../rooms/useRoom'
import { browserSessionStorage, saveSessionName } from '../identity/sessionName'
import { usePrivateBots } from './usePrivateBots'
import './DemoRoom.css'

type SeatClient = { seat: string; name: string; api: RoomApi }
type Snapshots = (RoomSnapshot | null)[]

const EMPTY: Snapshots = DEMO_SEATS.map(() => null)

function rejectsBallotSource(failure: unknown): boolean {
    return failure instanceof RoomApiError && failure.code === 'validation_error' && failure.details.some((detail) => detail.loc.includes('ballot_source'))
}

const GONE = new Set(['room_not_found', 'room_closed', 'not_a_member', 'session_required'])

function tabStorage(): StoragePort | null {
    try { return window.sessionStorage } catch { return null }
}

// No claim: each seat frame claims its own stored tab ID when it loads.
function seatClients(storage: StoragePort): SeatClient[] {
    return DEMO_SEATS.map(({ seat, name }) => ({ seat, name, api: createRoomApi({ session: createTabSession({ storage: seatStorage(storage, seat) }) }) }))
}

function message(failure: unknown): string {
    return failure instanceof Error ? failure.message : 'The demo request failed. Please retry.'
}

function initialDemo(): { demo: StoredDemo | null; clients: SeatClient[] | null } {
    const storage = tabStorage()
    const demo = storage ? readStoredDemo(storage.getItem(DEMO_STORAGE_KEY)) : null
    // The three window demo uses this window's ordinary membership (Alex), not seat memberships.
    if (demo?.mode === 'windows') return { demo, clients: null }
    return demo && storage ? { demo, clients: seatClients(storage) } : { demo: null, clients: null }
}

export default function DemoRoom() {
    const [{ demo, clients }, setLoaded] = useState(initialDemo)
    const [busy, setBusy] = useState<'start' | 'lobby' | null>(null)
    const [ballotSource, setBallotSource] = useState<BallotSource>('authored')
    const [mode, setMode] = useState<DemoMode>(() => demo?.mode ?? DEFAULT_DEMO_MODE)
    const [view, setViewState] = useState<DemoView>(() => readDemoView(tabStorage()?.getItem(DEMO_VIEW_KEY) ?? null))
    const setView = (next: DemoView) => { setViewState(next); try { tabStorage()?.setItem(DEMO_VIEW_KEY, next) } catch { /* Lasts for this view only. */ } }
    const [progress, setProgress] = useState<string[]>([])
    const [error, setError] = useState('')
    const [pollError, setPollError] = useState('')
    const [snapshots, setSnapshots] = useState<Snapshots>(EMPTY)
    const [scenarios, setScenarios] = useState<Scenario[]>([])
    const [selected, setSelected] = useState(0)
    const [split, setSplit] = useState(() => window.innerWidth >= SPLIT_VIEW_MIN_WIDTH)
    const [autoFollow, setAutoFollow] = useState(true)
    const [skipping, setSkipping] = useState(false)
    const hostView = snapshots[0]
    const hostCanSkip = Boolean(hostView?.game?.allowed_actions?.includes('skip_phase'))
    const solo = demo?.mode === 'solo'
    const apis = useMemo(() => clients?.map((client) => client.api) ?? null, [clients])
    const acceptBotSnapshot = useCallback((index: number, next: RoomSnapshot) => {
        setSnapshots((current) => current.map((item, position) => position === index ? acceptSnapshot(item, next) : item))
    }, [])
    const bots = useSoloBots({ enabled: solo, roomId: demo?.room_id ?? null, apis, snapshots, onSnapshot: acceptBotSnapshot })
    const privateBots = usePrivateBots({ enabled: solo, roomId: demo?.room_id ?? null, apis, snapshots })
    async function skipPhase() {
        const game = hostView?.game
        if (!demo || !clients || !game || skipping) return
        setSkipping(true)
        try {
            const next = await clients[0].api.command(demo.room_id, `rounds/${game.round_id}/skip-phase`, { command_id: crypto.randomUUID(), phase_id: game.phase_id })
            setSnapshots((current) => [next, ...current.slice(1)])
        } catch (failure) {
            setPollError(failure instanceof Error ? failure.message : 'Skipping the phase failed.')
        } finally {
            setSkipping(false)
        }
    }
    const resetToSetup = useCallback((notice?: string) => {
        try { tabStorage()?.removeItem(DEMO_STORAGE_KEY) } catch { /* Nothing persisted. */ }
        setLoaded({ demo: null, clients: null })
        setProgress([])
        setError(notice ?? '')
    }, [])
    const followRef = useRef(autoFollow && !split)
    const lastTargetRef = useRef('')

    useEffect(() => { followRef.current = autoFollow && !split }, [autoFollow, split])

    // Each seat polls its own snapshot, so indicators reflect that member's view.
    useEffect(() => {
        if (!demo || !clients) return
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        let current: Snapshots = EMPTY
        void clients[0].api.scenarios(controller.signal).then(setScenarios, () => { /* Role IDs remain visible. */ })
        async function tick() {
            const results = await Promise.allSettled(clients!.map((client) => client.api.snapshot(demo!.room_id, controller.signal)))
            if (controller.signal.aborted) return
            current = results.map((result, index) => result.status === 'fulfilled' ? acceptSnapshot(current[index], result.value) : current[index])
            setSnapshots(current)
            const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : [])
            const gone = failures.find((failure) => failure instanceof RoomApiError && GONE.has(failure.code))
            if (gone) {
                // The server no longer knows this game (usually a backend restart: rooms live in memory).
                // Drop the stale seats so the frames stop polling, and return to the setup screen.
                const storage = tabStorage()
                if (storage) {
                    DEMO_SEATS.forEach(({ seat }) => clearSeatSession(storage, seat))
                    try { storage.removeItem(DEMO_STORAGE_KEY) } catch { /* Nothing persisted. */ }
                }
                lastTargetRef.current = ''
                setLoaded({ demo: null, clients: null })
                setSnapshots(EMPTY)
                setProgress([])
                setPollError('')
                setError('The previous test game is gone because the server restarted. Start a new one below.')
                return
            }
            setPollError(failures.length ? message(failures[0]) : '')
            const target = followTarget(current)
            const room = current.find(Boolean)
            const key = target === null || !room?.game ? '' : `${room.game.phase_id}:${room.phase}:${target}`
            if (key && key !== lastTargetRef.current) {
                lastTargetRef.current = key
                if (followRef.current) setSelected(target!)
            }
            timer = setTimeout(() => void tick(), 1000)
        }
        void tick()
        return () => { controller.abort(); clearTimeout(timer) }
    }, [demo, clients])

    async function load(startGame: boolean) {
        const storage = tabStorage()
        if (!storage) { setError('This browser blocks session storage, which the demo frames need to share test memberships.'); return }
        setBusy(startGame ? 'start' : 'lobby')
        setError('')
        const steps: string[] = []
        const step = (text: string) => { steps.push(text); setProgress([...steps]) }
        if (mode === 'windows') {
            try {
                step('Alex is creating a room with this window\'s own membership…')
                saveSessionName(browserSessionStorage(), 'Alex')
                await roomApi.initializeSession()
                let room: RoomSnapshot | null = null
                for (let attempt = 0; !room; attempt++) {
                    try {
                        room = await roomApi.create({ command_id: crypto.randomUUID(), room_code: demoRoomCode(), display_name: 'Alex' })
                    } catch (failure) {
                        if (!(failure instanceof RoomApiError && failure.code === 'room_code_taken') || attempt >= 4) throw failure
                    }
                }
                const stored: StoredDemo = { room_id: room.room_id, room_code: room.room_code, mode, ballot: ballotSource }
                storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(stored))
                setLoaded({ demo: stored, clients: null })
            } catch (failure) {
                setError(message(failure))
            } finally {
                setBusy(null)
            }
            return
        }
        try {
            DEMO_SEATS.forEach(({ seat }) => clearSeatSession(storage, seat))
            const next = seatClients(storage)
            step(mode === 'solo' ? 'Creating test sessions: you play Alex; Morgan and Sam are automated…' : 'Creating separate test sessions for Alex, Morgan and Sam…')
            await Promise.all(next.map((client) => client.api.initializeSession()))
            step('Alex is creating a room…')
            let room: RoomSnapshot | null = null
            for (let attempt = 0; !room; attempt++) {
                try {
                    room = await next[0].api.create({ command_id: crypto.randomUUID(), room_code: demoRoomCode(), display_name: 'Alex' })
                } catch (failure) {
                    if (!(failure instanceof RoomApiError && failure.code === 'room_code_taken') || attempt >= 4) throw failure
                }
            }
            step(`Room ${room.room_code} created. Morgan and Sam are joining…`)
            const memberIds = [room.self_member_id]
            for (const client of next.slice(1)) {
                const joined = await client.api.join({ command_id: crypto.randomUUID(), room_code: room.room_code, display_name: client.name })
                memberIds.push(joined.self_member_id)
            }
            const stored: StoredDemo = { room_id: room.room_id, room_code: room.room_code, mode }
            storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(stored))
            if (startGame) {
                try {
                    step('Assigning roles: Alex is CEO, Morgan takes recovery and Sam communications…')
                    const catalog = await next[0].api.scenarios()
                    const scenario = pickDemoScenario(catalog)
                    const timing = scenario?.timings[0]?.profile_id
                    if (!scenario || !timing) throw new Error('No scenario with a timing profile is available.')
                    const latest = await next[0].api.snapshot(room.room_id)
                    const body = { ...startInput(latest, scenario, timing, demoRoles(latest, memberIds, scenario), crypto.randomUUID()), ballot_source: ballotSource }
                    step(`Alex starts “${scenario.title}” (${timing.replaceAll('_', ' ')}, ${ballotSource === 'ai' ? 'AI generated' : 'hardcoded T01'} voting options)…`)
                    try {
                        await next[0].api.start(room.room_id, body)
                    } catch (failure) {
                        if (!rejectsBallotSource(failure)) throw failure
                        // Servers without the optional field use their default ballot.
                        const { ballot_source: _omitted, ...plain } = body
                        void _omitted
                        await next[0].api.start(room.room_id, { ...plain, command_id: crypto.randomUUID() })
                        step('This server does not offer a voting options choice yet; it used its default ballot.')
                    }
                    step('Game started.')
                } catch (failure) {
                    setError(`The seats loaded, but Start failed: ${message(failure)} Start from Alex's lobby instead.`)
                }
            } else step('Seats loaded. Alex can assign roles and Start from the lobby.')
            lastTargetRef.current = ''
            setSnapshots(EMPTY)
            setSelected(0)
            setPollError('')
            setLoaded({ demo: stored, clients: next })
        } catch (failure) {
            setError(message(failure))
        } finally {
            setBusy(null)
        }
    }

    function reset() {
        const storage = tabStorage()
        if (storage) {
            DEMO_SEATS.forEach(({ seat }) => clearSeatSession(storage, seat))
            try { storage.removeItem(DEMO_STORAGE_KEY) } catch { /* Nothing persisted. */ }
        }
        lastTargetRef.current = ''
        setLoaded({ demo: null, clients: null })
        setSnapshots(EMPTY)
        setProgress([])
        setError('')
        setPollError('')
    }

    const roleName = (roleId: string | null) => roleId ? scenarios.flatMap((scenario) => scenario.roles).find((role) => role.role_id === roleId)?.name ?? roleId.replaceAll('_', ' ') : 'No role yet'

    if (demo?.mode === 'windows') return <WindowsDemo demo={demo} view={view} onReset={resetToSetup} />

    if (!demo || !clients) {
        return <DemoSetup mode={mode} onMode={setMode} view={view} onView={setView} ballotSource={ballotSource} onBallot={setBallotSource} busy={busy} progress={progress} error={error} onStart={() => void load(true)} onLobby={() => void load(false)} />
    }

    const hostRoom = snapshots[0]
    const phaseText = `${phaseLabel(hostRoom?.phase ?? null)}${hostRoom?.game ? ` · Round ${hostRoom.game.round_number}` : ''}`
    const alert = pollError || error || (solo ? bots.error || privateBots.error : '')
    const alexFrameSrc = soloFrameSrc(window.location.pathname, demo.room_id, view)

    if (solo) {
        // Solo games give the whole window to Alex's call. Morgan and Sam keep running without a visible strip;
        // the in game control bar carries Skip, and only a quiet Reset stays for after server restarts.
        return <main className="demo-room demo-room--solo">
            <button className="demo-reset-float" type="button" onClick={reset} title="Discard these test memberships and return to the demo setup">Reset demo</button>
            {alert && <p className="demo-error demo-error--float" role="alert">{alert}</p>}
            <div className="demo-frames">
                <section className="demo-frame" aria-label="Alex's player view">
                    <iframe title="Alex's player view (test membership)" src={alexFrameSrc} allow="autoplay; microphone; clipboard-write" />
                </section>
            </div>
        </main>
    }

    const statuses = snapshots.map(seatStatus)
    return <main className={`demo-room${split ? ' demo-room--split' : ''}`}>
        <header className="demo-bar">
            <div className="demo-bar__title">
                <span className="demo-badge">Test memberships · one window</span>
                <strong>Room {demo.room_code}</strong>
                <span className="demo-bar__phase">{phaseText}</span>
            </div>
            <div className="demo-seats" role="tablist" aria-label="Test participants">
                {clients.map((client, index) => {
                    const status = statuses[index]
                    const active = split || index === selected
                    return <button key={client.seat} type="button" role="tab" id={`demo-tab-${client.seat}`} aria-controls={`demo-panel-${client.seat}`} aria-selected={active}
                        className={`demo-seat${active ? ' demo-seat--active' : ''}${status.speaking || status.decide || status.ceoTie ? ' demo-seat--attention' : ''}`}
                        onClick={() => setSelected(index)}>
                        <span className="demo-seat__name">{client.name} · {status.roleId === 'ceo' ? 'CEO' : roleName(status.roleId)}</span>
                        <span className="demo-seat__flags">
                            {status.speaking && <span className="demo-flag demo-flag--speaking">Speaking now</span>}
                            {status.decide && <span className="demo-flag demo-flag--decide">Decide now</span>}
                            {status.voted && <span className="demo-flag demo-flag--voted">Voted</span>}
                            {status.ceoTie && <span className="demo-flag demo-flag--decide">CEO tie</span>}
                            <span className="demo-flag">{phaseLabel(status.phase)}</span>
                        </span>
                    </button>
                })}
            </div>
            <div className="demo-bar__controls">
                <label className="demo-toggle"><input type="checkbox" checked={split} onChange={(event) => setSplit(event.target.checked)} /> Split view</label>
                <label className="demo-toggle" title="In tab view, switch to the speaker, the next voter, or the CEO in a tie"><input type="checkbox" checked={autoFollow} disabled={split} onChange={(event) => setAutoFollow(event.target.checked)} /> Auto follow</label>
                {hostCanSkip && <button className="demo-secondary demo-secondary--small" type="button" disabled={skipping} onClick={() => void skipPhase()} title="Ends the current phase for everyone (host command, sent as Alex)">{skipping ? 'Skipping…' : 'Skip phase ⏭'}</button>}
                <button className="demo-secondary demo-secondary--small" type="button" onClick={reset}>Reset demo</button>
            </div>
        </header>
        {alert && <p className="demo-error demo-error--bar" role="alert">{alert}</p>}
        <div className="demo-frames">
            {clients.map((client, index) => {
                const visible = split || index === selected
                return <section key={client.seat} id={`demo-panel-${client.seat}`} role="tabpanel" aria-labelledby={`demo-tab-${client.seat}`} className={`demo-frame${visible ? '' : ' demo-frame--hidden'}`} inert={!visible}>
                    {split && <p className="demo-frame__label">{client.name} · {statuses[index].roleId === 'ceo' ? 'CEO' : roleName(statuses[index].roleId)} <span>test membership</span></p>}
                    <iframe title={`${client.name}'s player view (test membership)`} src={`${window.location.pathname}?seat=${client.seat}#/room/${demo.room_id}`} allow="autoplay; microphone; clipboard-write" />
                </section>
            })}
        </div>
    </main>
}
