import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoomApi, RoomApiError } from '../../services/rooms'
import type { RoomApi, RoomSnapshot, Scenario } from '../../services/rooms'
import { clearSeatSession, createTabSession, seatStorage } from '../../services/tabSession'
import type { StoragePort } from '../../services/tabSession'
import { acceptSnapshot, startInput } from '../rooms/roomState'
import { DEFAULT_DEMO_MODE, DEMO_SEATS, DEMO_STORAGE_KEY, SPLIT_VIEW_MIN_WIDTH, demoRoles, demoRoomCode, followTarget, phaseLabel, pickDemoScenario, readStoredDemo, seatStatus } from './demoModel'
import type { BallotSource, DemoMode, StoredDemo } from './demoModel'
import { useSoloBots } from './useSoloBots'
import { usePrivateBots } from './usePrivateBots'
import './DemoRoom.css'

type SeatClient = { seat: string; name: string; api: RoomApi }
type Snapshots = (RoomSnapshot | null)[]

const EMPTY: Snapshots = DEMO_SEATS.map(() => null)
// The four saved T01 Cedar Bridge recordings, in seat order, plus the guide.
const DEMO_RECORDINGS = [
    { seat: 'Alex', topic: 'Leadership', text: 'Appointing an interim coordinator when the director is unavailable and no alternate is named.', seconds: '14.21' },
    { seat: 'Morgan', topic: 'Recovery', text: 'Checking backup usability, dependencies and a restoration estimate before promising recovery.', seconds: '17.18' },
    { seat: 'Sam', topic: 'Communications', text: 'Considering approved paper appointments and separating facts, unknowns and the next update.', seconds: '14.63' },
    { seat: 'Recorded decision guide', topic: 'Voting', text: 'Reads the fixed T01 choices when voting opens. It is labelled as recorded and never counts as a ballot.', seconds: '19.74' },
]

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
    return demo && storage ? { demo, clients: seatClients(storage) } : { demo: null, clients: null }
}

export default function DemoRoom() {
    const [{ demo, clients }, setLoaded] = useState(initialDemo)
    const [busy, setBusy] = useState<'start' | 'lobby' | null>(null)
    const [ballotSource, setBallotSource] = useState<BallotSource>('authored')
    const [mode, setMode] = useState<DemoMode>(() => demo?.mode ?? DEFAULT_DEMO_MODE)
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

    if (!demo || !clients) {
        return <main className="demo-setup">
            <section className="demo-setup__card" aria-labelledby="demo-title">
                <button className="demo-link" type="button" onClick={() => { window.location.hash = '/' }}>‹ Back home</button>
                <p className="demo-eyebrow">Single window test</p>
                <h1 id="demo-title">{mode === 'solo' ? 'Solo demo' : 'Three player demo'}</h1>
                {mode === 'solo'
                    ? <p className="demo-lede">Play a full game as <strong>Alex, the CEO and host</strong>. Morgan (IT recovery) and Sam (communications) are automated board members with their own <strong>test memberships</strong>: they play their saved clips on their turns and vote after you (in individual decision scenarios such as T01 Cedar Bridge, they each write their own decision).</p>
                    : <p className="demo-lede">Drive a full three player game from this one window. Alex, Morgan and Sam each get a separate <strong>test membership</strong> on the room server, shown side by side so you can act as every player.</p>}
                <ol className="demo-steps">
                    <li>Alex creates a room; Morgan and Sam join it.</li>
                    <li>Alex is CEO; Morgan takes the recovery (IT) role and Sam the communications role.</li>
                    <li>Alex starts the T01 Cedar Bridge test (or the first scenario if it is not listed), so the game opens on the briefing.</li>
                </ol>
                <fieldset className="demo-options" disabled={Boolean(busy)}>
                    <legend>Mode</legend>
                    <label><input type="radio" name="demo-mode" value="solo" checked={mode === 'solo'} onChange={() => setMode('solo')} /> Solo: you are Alex (CEO); Morgan and Sam are automated</label>
                    <label><input type="radio" name="demo-mode" value="seats" checked={mode === 'seats'} onChange={() => setMode('seats')} /> Three seats in one window <span>(you act as every player)</span></label>
                </fieldset>
                <fieldset className="demo-options" disabled={Boolean(busy)}>
                    <legend>Voting options</legend>
                    <label><input type="radio" name="ballot-source" value="authored" checked={ballotSource === 'authored'} onChange={() => setBallotSource('authored')} /> Hardcoded T01 choices <span>(matches recorded decision guide)</span></label>
                    <label><input type="radio" name="ballot-source" value="ai" checked={ballotSource === 'ai'} onChange={() => setBallotSource('ai')} /> AI generated by Vertex agents</label>
                </fieldset>
                <div className="demo-actions">
                    <button className="demo-primary" type="button" disabled={Boolean(busy)} aria-busy={busy === 'start'} onClick={() => void load(true)}>{busy === 'start' ? 'Loading…' : mode === 'solo' ? 'Start solo game as Alex' : 'Load 3 test participants'}</button>
                    <button className="demo-secondary" type="button" disabled={Boolean(busy)} aria-busy={busy === 'lobby'} onClick={() => void load(false)}>{busy === 'lobby' ? 'Loading…' : 'Load seats only (start from lobby)'}</button>
                </div>
                {progress.length > 0 && <ol className="demo-progress" aria-live="polite">{progress.map((text, index) => <li key={index}>{text}</li>)}</ol>}
                {error && <p className="demo-error" role="alert">{error}</p>}
                <details className="demo-recordings" open>
                    <summary>Demo recordings (4 saved T01 clips)</summary>
                    <ul>{DEMO_RECORDINGS.map((clip) => <li key={clip.topic}><strong>{clip.topic}</strong> · {clip.seat} · {clip.seconds}s<span>{clip.text}</span></li>)}</ul>
                    <p>Saved clips play only when you choose; their captions become contributions only after an explicit commit.</p>
                </details>
                <p className="demo-note">These memberships live only in this browser tab. Reloading keeps them; Reset demo discards them.</p>
            </section>
        </main>
    }

    const hostRoom = snapshots[0]
    const phaseText = `${phaseLabel(hostRoom?.phase ?? null)}${hostRoom?.game ? ` · Round ${hostRoom.game.round_number}` : ''}`
    const alert = pollError || error || (solo ? bots.error || privateBots.error : '')
    const alexFrameSrc = `${window.location.pathname}?seat=${DEMO_SEATS[0].seat}#/room/${demo.room_id}`

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
