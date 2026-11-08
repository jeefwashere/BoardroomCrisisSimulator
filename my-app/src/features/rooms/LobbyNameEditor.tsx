import { useEffect, useId, useRef, useState } from 'react'
import { PencilIcon } from '../../common/icons'
import { displayNameError, normalizeDisplayName } from '../identity/sessionName'
import { useSessionName } from '../identity/useSessionName'
import '../identity/SessionName.css'
import './LobbyNameEditor.css'

type Props = { name: string; rename: (name: string) => Promise<void>; disabled?: boolean }

export default function LobbyNameEditor({ name, rename, disabled = false }: Props) {
    const { updateName } = useSessionName()
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(name)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const errorId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const editingRef = useRef(false)
    const pendingRef = useRef(false)
    const restoreFocusRef = useRef(false)

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus()
            inputRef.current?.select()
        } else if (restoreFocusRef.current) {
            buttonRef.current?.focus()
            restoreFocusRef.current = false
        }
    }, [editing])

    function beginEditing() {
        if (disabled) return
        setDraft(name)
        setError('')
        editingRef.current = true
        setEditing(true)
    }

    function cancelEditing() {
        if (pendingRef.current) return
        editingRef.current = false
        restoreFocusRef.current = true
        setError('')
        setEditing(false)
    }

    async function save(restoreFocus = false) {
        // Enter and its subsequent blur must share one server rename request.
        if (!editingRef.current || pendingRef.current || disabled) return
        const validation = displayNameError(draft)
        if (validation) { setError(validation); return }
        const nextName = normalizeDisplayName(draft)
        editingRef.current = false
        restoreFocusRef.current = restoreFocus
        setError('')
        if (nextName === name) { setEditing(false); return }
        pendingRef.current = true
        setSaving(true)
        try {
            await rename(nextName)
            updateName(nextName)
            setEditing(false)
        } catch (failure) {
            editingRef.current = true
            restoreFocusRef.current = false
            setError(failure instanceof Error ? failure.message : 'The name could not be updated.')
        } finally {
            pendingRef.current = false
            setSaving(false)
        }
    }

    return <span className={`session-name lobby-name-editor${editing ? ' is-editing' : ''}`} aria-busy={saving}>
        {editing ? <>
            <span className="session-name__edit">
                <input ref={inputRef} className="session-name__input" type="text" aria-label="Edit your name" autoComplete="off" maxLength={40} size={Math.max(4, Math.min(draft.length + 1, 28))} value={draft} readOnly={saving} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
                    onChange={(event) => { setDraft(event.target.value); setError('') }}
                    onBlur={() => { if (pendingRef.current) restoreFocusRef.current = false; else void save() }}
                    onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return
                        if (event.key === 'Enter') { event.preventDefault(); void save(true) }
                        else if (event.key === 'Escape') { event.preventDefault(); cancelEditing() }
                    }} />
            </span>
            <PencilIcon />
        </> : <button ref={buttonRef} className="session-name__button" type="button" disabled={disabled} onClick={beginEditing} aria-label={`Edit your name, currently ${name}`} title={name}>
            <span className="session-name__text">{name}</span><PencilIcon />
        </button>}
        {error && <span className="lobby-name-editor__error" id={errorId} role="alert">{error}</span>}
    </span>
}
