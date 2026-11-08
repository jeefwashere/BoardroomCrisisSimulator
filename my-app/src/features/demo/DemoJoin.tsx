import { useState } from 'react'
import type { RoomSnapshot } from '../../services/rooms'
import { roomApi, errorMessage } from '../rooms/useRoom'
import { useSessionName } from '../identity/useSessionName'
import { STAGE_STORAGE_KEY } from '../boardroom3d/boardroomModel'
import { readJoinRequest } from './demoModel'
import './DemoRoom.css'

/**
 * Three window demo, Morgan's or Sam's side: `#/demo/join?code=ABC123&seat=morgan`. Joins the room with this
 * window's own membership, then waits in the lobby for Alex to start. The click also lets this tab play audio.
 */
export default function DemoJoin({ query, onEnter }: { query: string; onEnter: (room: RoomSnapshot) => void }) {
    const request = readJoinRequest(query)
    const { updateName } = useSessionName()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    async function join() {
        if (!request || busy) return
        setBusy(true)
        setError('')
        try {
            updateName(request.name)
            if (request.view) { try { window.sessionStorage.setItem(STAGE_STORAGE_KEY, request.view) } catch { /* Uses the default stage. */ } }
            await roomApi.initializeSession()
            const room = await roomApi.join({ command_id: crypto.randomUUID(), room_code: request.code, display_name: request.name })
            onEnter(room)
        } catch (failure) {
            setError(errorMessage(failure))
            setBusy(false)
        }
    }

    return <main className="demo-setup">
        <section className="demo-setup__card" aria-labelledby="join-title">
            <p className="demo-eyebrow">Three window test</p>
            {request ? <>
                <h1 id="join-title">Join as {request.name}</h1>
                <p className="demo-lede">Room <strong>{request.code}</strong>. You play <strong>{request.name}, the {request.role}</strong>. Alex starts the game once everyone has joined; you take your own turns from this window.</p>
                <div className="demo-actions">
                    <button className="demo-primary" type="button" disabled={busy} aria-busy={busy} onClick={() => void join()}>{busy ? 'Joining…' : `Join as ${request.name}`}</button>
                </div>
            </> : <>
                <h1 id="join-title">This join link is not valid</h1>
                <p className="demo-lede">Ask Alex for a new link, or join from the home page with the room code.</p>
            </>}
            {error && <p className="demo-error" role="alert">{error}</p>}
            <button className="demo-link" type="button" onClick={() => { window.location.hash = '/' }}>‹ Back home</button>
        </section>
    </main>
}
