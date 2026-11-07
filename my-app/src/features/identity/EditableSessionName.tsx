import { useEffect, useRef, useState } from 'react'
import { PencilIcon } from '../../common/icons'
import { MAX_NAME_LENGTH, resolveNameEdit } from './sessionName'
import { useSessionName } from './useSessionName'

function EditableSessionName() {
    const { name, updateName } = useSessionName()
    const [isEditing, setIsEditing] = useState(false)
    const [draft, setDraft] = useState(name)
    const inputRef = useRef<HTMLInputElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const editingRef = useRef(false)
    const restoreFocusRef = useRef(false)

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus()
            inputRef.current?.select()
        } else if (restoreFocusRef.current) {
            buttonRef.current?.focus()
            restoreFocusRef.current = false
        }
    }, [isEditing])

    function startEditing() {
        setDraft(name)
        editingRef.current = true
        setIsEditing(true)
    }

    function finishEditing(save: boolean, restoreFocus = false) {
        // Enter can also cause blur as the input disappears. Commit only once.
        if (!editingRef.current) return
        editingRef.current = false
        const nextName = save ? resolveNameEdit(name, draft) : name
        if (nextName !== name) updateName(nextName)
        restoreFocusRef.current = restoreFocus
        setIsEditing(false)
    }

    if (!name) return null

    return (
        <div className="session-name">
            {isEditing ? (
                <>
                    <input
                        ref={inputRef}
                        className="session-name__input"
                        aria-label="Edit your name"
                        type="text"
                        autoComplete="off"
                        maxLength={MAX_NAME_LENGTH}
                        size={Math.max(4, Math.min(draft.length + 1, 28))}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => finishEditing(true)}
                        onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) return
                            if (event.key === 'Enter') {
                                event.preventDefault()
                                finishEditing(true, true)
                            } else if (event.key === 'Escape') {
                                event.preventDefault()
                                finishEditing(false, true)
                            }
                        }}
                    />
                    <PencilIcon />
                </>
            ) : (
                <button ref={buttonRef} className="session-name__button" type="button" onClick={startEditing} aria-label={`Edit your name, currently ${name}`} title={name}>
                    <span>{name}</span>
                    <PencilIcon />
                </button>
            )}
        </div>
    )
}

export default EditableSessionName
