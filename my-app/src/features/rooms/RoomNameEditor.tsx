import { useRef, useState } from 'react'
import type { RoomSnapshot } from '../../services/rooms'
import { displayNameError, normalizeDisplayName } from '../identity/sessionName'
import { useSessionName } from '../identity/useSessionName'
import './RoomNameEditor.css'

type Props = { room: RoomSnapshot; rename: (name: string) => Promise<void>; disabled?: boolean }
export default function RoomNameEditor({ room, rename, disabled = false }: Props) {
    const self = room.members.find((member) => member.member_id === room.self_member_id)
    const { updateName } = useSessionName()
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const pending = useRef(false)
    if (!self) return null
    async function save() {
        if (pending.current) return
        const validation = displayNameError(draft)
        if (validation) { setError(validation); return }
        pending.current = true
        setBusy(true)
        setError('')
        try {
            const name = normalizeDisplayName(draft)
            await rename(name)
            updateName(name)
            setEditing(false)
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'The name could not be updated.') }
        finally { pending.current = false; setBusy(false) }
    }
    return <div className="room-name-editor">
        {editing ? <form onSubmit={(event) => { event.preventDefault(); void save() }}>
            <label htmlFor="room-display-name">Your name</label>
            <input id="room-display-name" autoFocus maxLength={40} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} />
            <button type="submit" disabled={busy || disabled}>{busy ? 'Saving…' : 'Save name'}</button>
            <button type="button" disabled={busy} onClick={() => { setEditing(false); setError('') }}>Cancel</button>
        </form> : <button type="button" disabled={disabled || room.phase === 'ended'} aria-label={`Edit room name, currently ${self.display_name}`} onClick={() => { setDraft(self.display_name); setError(''); setEditing(true) }}>Your name: {self.display_name} <span aria-hidden="true">✎</span></button>}
        {error && <p role="alert">{error}</p>}
    </div>
}
