import { useEffect, useRef, useState } from 'react'
import { useSessionName } from '../identity/useSessionName'
import EditableSessionName from '../identity/EditableSessionName'
import { RoomApiError } from '../../services/rooms'
import type { CreateRoomInput, JoinRoomInput, Scenario } from '../../services/rooms'
import { errorMessage, roomApi } from './useRoom'
import '../../pages/Home.css'

function RoomEntry({ mode, initialCode = '' }: { mode: 'host' | 'join'; initialCode?: string }) {
    const { name } = useSessionName()
    const [code, setCode] = useState(() => mode === 'host' ? crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase() : initialCode)
    const [role, setRole] = useState('')
    const [needsRole, setNeedsRole] = useState(false)
    const [scenarios, setScenarios] = useState<Scenario[]>([])
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const requestRef = useRef<AbortController | null>(null)
    const intentRef = useRef<{ key: string; body: CreateRoomInput | JoinRoomInput } | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        roomApi.scenarios(controller.signal).then(setScenarios).catch((failure: unknown) => {
            if (!controller.signal.aborted) setError(errorMessage(failure))
        })
        return () => { controller.abort(); requestRef.current?.abort() }
    }, [])

    async function submit() {
        if (requestRef.current || !name) return
        const controller = new AbortController()
        requestRef.current = controller
        setBusy(true)
        setError('')
        const key = JSON.stringify([mode, code.trim().toUpperCase(), name, role])
        if (intentRef.current?.key !== key) {
            intentRef.current = { key, body: {
                command_id: crypto.randomUUID(), room_code: code.trim().toUpperCase(), display_name: name,
                ...(mode === 'join' && role ? { role_id: role } : {}),
            } }
        }
        try {
            await roomApi.initializeSession(controller.signal)
            const room = await (mode === 'host' ? roomApi.create(intentRef.current.body, controller.signal) : roomApi.join(intentRef.current.body, controller.signal))
            if (!controller.signal.aborted) window.location.hash = `/room/${room.room_id}`
        } catch (failure) {
            if (!controller.signal.aborted) {
                setError(errorMessage(failure))
                if (mode === 'join' && failure instanceof RoomApiError && failure.code === 'invalid_role') setNeedsRole(true)
                if (failure instanceof RoomApiError && failure.code === 'role_not_yet_allowed') { setRole(''); setNeedsRole(false) }
            }
        } finally {
            requestRef.current = null
            if (!controller.signal.aborted) setBusy(false)
        }
    }

    return <main className="home-menu">
        <EditableSessionName />
        <section className="home-menu__content room-entry" aria-labelledby="entry-title">
            <h1 id="entry-title">{mode === 'host' ? 'Host a boardroom' : 'Join a boardroom'}</h1>
            <form className="room-entry-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
                <label htmlFor="entry-code">Room code</label>
                <input id="entry-code" className="home-menu__input" required pattern="[A-Za-z0-9]{6}" maxLength={6} autoCapitalize="characters" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} disabled={busy} />
                <p>Joining as {name || 'your selected name'}. Names stay fixed for this room.</p>
                {mode === 'join' && needsRole && <>
                    <label htmlFor="join-role">Role for a room already in progress</label>
                    <select id="join-role" required value={role} onChange={(event) => setRole(event.target.value)} disabled={busy}>
                        <option value="">Choose an available role</option>
                        {scenarios[0]?.roles.filter((option) => option.role_id !== 'ceo').map((option) => <option key={option.role_id} value={option.role_id}>{option.name}</option>)}
                    </select>
                    <p>This room has started. Choose a role. The server determines your first eligible round.</p>
                </>}
                {error && <p role="alert">{error}</p>}
                <button className="home-menu__button" type="submit" disabled={busy || !name}>{busy ? 'Connecting…' : mode === 'host' ? 'Create room' : 'Join room'}<span aria-hidden="true">›</span></button>
                <button className="room-text-button" type="button" onClick={() => { window.location.hash = '/' }}>Back</button>
            </form>
        </section>
    </main>
}

export default RoomEntry
