import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoomApi, RoomApiError } from '../../services/rooms'
import type { RoomApi, RoomSnapshot, Scenario } from '../../services/rooms'
import { clearSeatSession, createTabSession, seatStorage, TAB_TOKEN_KEY } from '../../services/tabSession'
import type { StoragePort } from '../../services/tabSession'
import { acceptSnapshot, startInput } from '../rooms/roomState'
import { DEMO_SEATS, DEMO_STORAGE_KEY, demoRoles, demoRoomCode, followTarget, phaseLabel, pickDemoScenario, readStoredDemo, seatStatus } from './demoModel'
import type { BallotSource, StoredDemo } from './demoModel'
import DemoConfigPopover from './DemoConfigPopover'
import DemoUserSelect from './DemoUserSelect'
import RoomChat from '../rooms/RoomChat'
import { createChatStore } from '../rooms/chatState'
import { clearDemoSession, createDemoEnder, isDemoExitRequest, leaveDemoImmediately } from './demoExit'
import SessionEnded from '../rooms/SessionEnded'
import { sessionClosure } from '../rooms/sessionClosure'
import type { SessionClosure } from '../rooms/sessionClosure'
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

const GONE = new Set(['room_not_found', 'room_closed', 'host_disconnected', 'not_a_member', 'session_required'])

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
    const [progress, setProgress] = useState<string[]>([])
    const [error, setError] = useState('')
    const [pollError, setPollError] = useState('')
    const [snapshots, setSnapshots] = useState<Snapshots>(EMPTY)
    const [scenarios, setScenarios] = useState<Scenario[]>([])
    const [selected, setSelected] = useState(0)
    const [autoFollow, setAutoFollow] = useState(true)
    const [skipping, setSkipping] = useState(false)
    const [closedSession, setClosedSession] = useState<SessionClosure | null>(null)
    const exitingRef = useRef(false)
    const framesRef = useRef<Record<string, HTMLIFrameElement | null>>({})
    const endDemoRoom = useMemo(() => {
        if (!demo || !clients) return null
        let token: string | null = null
        try { const storage = tabStorage(); token = storage ? seatStorage(storage, DEMO_SEATS[0].seat).getItem(TAB_TOKEN_KEY) : null } catch { /* Local exit still works without saved credentials. */ }
        if (!token) return async () => {}
        const hostToken = token
        // The exit request retains its credential in memory and never writes it back after cleanup.
        const detached = createRoomApi({ baseUrl: clients[0].api.baseUrl, session: { token: async () => hostToken } })
        return createDemoEnder(detached, demo.room_id)
    }, [demo, clients])
    const hostView = snapshots[0]
    const hostCanSkip = Boolean(hostView?.game?.allowed_actions?.includes('skip_phase'))
    async function skipPhase() {
        const game = hostView?.game
        if (!demo || !clients || !game || skipping || exitingRef.current) return
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
    const followRef = useRef(autoFollow)
    const lastTargetRef = useRef('')

    useEffect(() => { followRef.current = autoFollow }, [autoFollow])

    // Each chat keeps its own authenticated client, draft and uncertain request.
    // Only the selected participant's store is mounted in the shared window panel.
    const chatStores = useMemo(() => demo && clients ? clients.map((client, index) => createChatStore({
        api: client.api, roomId: demo.room_id,
        refreshRoom: async () => {
            const next = await client.api.snapshot(demo.room_id)
            setSnapshots((current) => current.map((snapshot, seatIndex) => seatIndex === index ? acceptSnapshot(snapshot, next) : snapshot))
        },
    })) : [], [demo, clients])
    const refreshSelectedRoom = useCallback(async () => {
        if (!demo || !clients) return
        const next = await clients[selected].api.snapshot(demo.room_id)
        setSnapshots((current) => current.map((snapshot, index) => index === selected ? acceptSnapshot(snapshot, next) : snapshot))
    }, [demo, clients, selected])

    // Each seat polls its own snapshot, so indicators reflect that member's view.
    useEffect(() => {
        if (!demo || !clients || closedSession) return
        const controller = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        let current: Snapshots = EMPTY
        void clients[0].api.scenarios(controller.signal).then(setScenarios, () => { /* Role IDs remain visible. */ })
        async function tick() {
            const results = await Promise.allSettled(clients!.map((client) => client.api.snapshot(demo!.room_id, controller.signal)))
            if (controller.signal.aborted) return
            current = results.map((result, index) => result.status === 'fulfilled' ? acceptSnapshot(current[index], result.value) : current[index])
            setSnapshots((latest) => current.map((snapshot, index) => snapshot ? acceptSnapshot(latest[index], snapshot) : latest[index]))
            const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : [])
            const gone = failures.find((failure) => failure instanceof RoomApiError && GONE.has(failure.code))
            const closure = failures.map(sessionClosure).find(Boolean)
            if (closure) setClosedSession(closure)
            setPollError(gone ? `${message(gone).replace(/\.?$/, '.')} The server may have restarted. Reset the demo to load new test participants.` : failures.length ? message(failures[0]) : '')
            const target = followTarget(current)
            const room = current.find(Boolean)
            const key = target === null || !room?.game ? '' : `${room.game.phase_id}:${room.phase}:${target}`
            if (key && key !== lastTargetRef.current) {
                lastTargetRef.current = key
                if (followRef.current) setSelected(target!)
            }
            if (!gone) timer = setTimeout(() => void tick(), 1000)
        }
        void tick()
        return () => { controller.abort(); clearTimeout(timer) }
    }, [demo, clients, closedSession])

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
            step('Creating separate test sessions for Alex, Morgan and Sam…')
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
            const stored: StoredDemo = { room_id: room.room_id, room_code: room.room_code }
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

    const reset = useCallback((expectedRoomId?: string) => {
        clearDemoSession(tabStorage(), expectedRoomId)
        lastTargetRef.current = ''
        setLoaded({ demo: null, clients: null })
        setSnapshots(EMPTY)
        setProgress([])
        setError('')
        setPollError('')
        setClosedSession(null)
    }, [])

    const finishDemo = useCallback((returnHome: boolean) => {
        if (exitingRef.current || !endDemoRoom) return
        exitingRef.current = true
        try {
            // Returning home and discarding the demo are unconditional. Server cleanup
            // is best effort and uses an API client that cannot restore saved credentials.
            leaveDemoImmediately(endDemoRoom, () => reset(demo?.room_id), () => { if (returnHome) window.location.hash = '/' })
        } finally {
            exitingRef.current = false
        }
    }, [demo, endDemoRoom, reset])

    useEffect(() => {
        if (!demo || !clients) return
        const requested = (event: MessageEvent<unknown>) => {
            const frames = clients.map((client) => ({ seat: client.seat, source: framesRef.current[client.seat]?.contentWindow }))
            if (isDemoExitRequest(event, window.location.origin, demo.room_id, frames)) void finishDemo(true)
        }
        window.addEventListener('message', requested)
        return () => window.removeEventListener('message', requested)
    }, [demo, clients, finishDemo])

    const roleName = (roleId: string | null) => roleId ? scenarios.flatMap((scenario) => scenario.roles).find((role) => role.role_id === roleId)?.name ?? roleId.replaceAll('_', ' ') : 'No role yet'

    if (closedSession) return <SessionEnded reason={closedSession} onBack={() => finishDemo(true)} />

    if (!demo || !clients) {
        return <main className="demo-setup">
            <section className="demo-setup__card" aria-labelledby="demo-title">
                <button className="demo-link" type="button" onClick={() => { window.location.hash = '/' }}>‹ Back home</button>
                <p className="demo-eyebrow">Single window test</p>
                <h1 id="demo-title">Three player demo</h1>
                <p className="demo-lede">Drive a full three player game from this one window. Alex, Morgan and Sam each get a separate <strong>test membership</strong>. View one participant at a time and switch users from Demo config in the bottom left.</p>
                <ol className="demo-steps">
                    <li>Alex creates a room; Morgan and Sam join it.</li>
                    <li>Alex is CEO; Morgan takes the recovery (IT) role and Sam the communications role.</li>
                    <li>Alex starts the T01 Cedar Bridge test (or the first scenario if it is not listed), so the game opens on the briefing.</li>
                </ol>
                <fieldset className="demo-options" disabled={Boolean(busy)}>
                    <legend>Voting options</legend>
                    <label><input type="radio" name="ballot-source" value="authored" checked={ballotSource === 'authored'} onChange={() => setBallotSource('authored')} /> Hardcoded T01 choices <span>(matches recorded decision guide)</span></label>
                    <label><input type="radio" name="ballot-source" value="ai" checked={ballotSource === 'ai'} onChange={() => setBallotSource('ai')} /> AI generated by Vertex agents</label>
                </fieldset>
                <div className="demo-actions">
                    <button className="demo-primary" type="button" disabled={Boolean(busy)} aria-busy={busy === 'start'} onClick={() => void load(true)}>{busy === 'start' ? 'Loading…' : 'Load 3 test participants'}</button>
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

    const statuses = snapshots.map(seatStatus)
    const selectedRoom = snapshots[selected]
    const users = clients.map((client, index) => ({ seat: client.seat, name: snapshots[index]?.members.find((member) => member.member_id === snapshots[index]?.self_member_id)?.display_name ?? client.name }))
    return <main className="demo-room">
        <div className="demo-frames">
            {clients.map((client, index) => {
                const visible = index === selected
                return <section key={client.seat} id={`demo-panel-${client.seat}`} aria-label={`${users[index].name}'s player view`} aria-hidden={!visible} className={`demo-frame${visible ? '' : ' demo-frame--hidden'}`} inert={!visible}>
                    <iframe ref={(frame) => { framesRef.current[client.seat] = frame }} title={`${client.name}'s player view (test membership)`} src={`${window.location.pathname}?seat=${client.seat}#/room/${demo.room_id}`} allow="autoplay; microphone; clipboard-write" />
                </section>
            })}
        </div>
        <DemoConfigPopover attention={Boolean(pollError || error)}>
            <div className="demo-config__heading"><strong>Demo config</strong><span>Room {demo.room_code}</span></div>
            <p className="demo-config__phase">{phaseLabel(selectedRoom?.phase ?? null)}{selectedRoom?.game ? ` · Round ${selectedRoom.game.round_number}` : ''} · {roleName(statuses[selected].roleId)}</p>
            {(pollError || error) && <p className="demo-error" role="alert">{pollError || error}</p>}
            <label className="demo-toggle" title="Switch to the speaker, next voter, or CEO in a tie"><input type="checkbox" checked={autoFollow} onChange={(event) => setAutoFollow(event.target.checked)} /> Auto follow</label>
            <div className="demo-config__actions">
                {hostCanSkip && <button className="demo-secondary demo-secondary--small" type="button" disabled={skipping} onClick={() => void skipPhase()} title="Ends the current phase for everyone as the demo host">{skipping ? 'Skipping…' : 'Skip phase'}</button>}
                <button className="demo-secondary demo-secondary--small" type="button" onClick={() => finishDemo(false)}>Reset demo</button>
                <button className="demo-link" type="button" onClick={() => finishDemo(true)}>Leave demo</button>
            </div>
            <div className="demo-config__user"><span>Current user</span><DemoUserSelect users={users} selected={selected} onSelect={(index) => { setAutoFollow(false); followRef.current = false; setSelected(index) }} /></div>
        </DemoConfigPopover>
        {selectedRoom && <RoomChat room={selectedRoom} scenarios={scenarios} refreshRoom={refreshSelectedRoom} chatStore={chatStores[selected]} identityLabel={users[selected].name} />}
    </main>
}
