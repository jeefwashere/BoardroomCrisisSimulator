import { useEffect, useRef, useState } from 'react'
import { displayNameError, MAX_NAME_LENGTH, normalizeDisplayName } from './sessionName'

function InitialNamePrompt({ onConfirm }: { onConfirm: (name: string) => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        const dialog = dialogRef.current
        if (dialog && !dialog.open) dialog.showModal()
        return () => { if (dialog?.open) dialog.close() }
    }, [])

    return (
        <dialog
            ref={dialogRef}
            className="session-name-prompt"
            aria-labelledby="name-prompt-title"
            onCancel={(event) => event.preventDefault()}
        >
            <form
                className="session-name-prompt__form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault()
                    const validationError = displayNameError(draft)
                    if (validationError) { setError(validationError); return }
                    onConfirm(normalizeDisplayName(draft))
                }}
            >
                <h2 id="name-prompt-title">What should we call you?</h2>
                <label htmlFor="initial-display-name">Your name</label>
                <input
                    id="initial-display-name"
                    name="displayName"
                    type="text"
                    autoComplete="name"
                    autoFocus
                    required
                    maxLength={MAX_NAME_LENGTH}
                    value={draft}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'name-prompt-error' : undefined}
                    onChange={(event) => { setDraft(event.target.value); setError('') }}
                />
                {error && <p id="name-prompt-error" className="session-name-prompt__error" role="alert">{error}</p>}
                <button type="submit">Continue <span aria-hidden="true">↗</span></button>
            </form>
        </dialog>
    )
}

export default InitialNamePrompt
