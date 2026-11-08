import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { displayNameError, MAX_NAME_LENGTH, normalizeDisplayName } from './sessionName'

function InitialNamePrompt({ onConfirm, onExited }: { onConfirm: (name: string) => void; onExited: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState('')
    const [isClosing, setIsClosing] = useState(false)
    const reducedMotion = useReducedMotion() ?? false

    useEffect(() => {
        const dialog = dialogRef.current
        if (dialog && !dialog.open) dialog.showModal()
        return () => { if (dialog?.open) dialog.close() }
    }, [])

    return (
        <motion.dialog
            ref={dialogRef}
            className="session-name-prompt"
            aria-labelledby="name-prompt-title"
            onCancel={(event) => event.preventDefault()}
            initial={{ opacity: 1 }}
            animate={{ opacity: isClosing ? 0 : 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.28, ease: 'easeOut' }}
            onAnimationComplete={() => { if (isClosing) onExited() }}
        >
            <form
                className="session-name-prompt__form"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault()
                    if (isClosing) return
                    const validationError = displayNameError(draft)
                    if (validationError) { setError(validationError); return }
                    onConfirm(normalizeDisplayName(draft))
                    setIsClosing(true)
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
                    disabled={isClosing}
                    maxLength={MAX_NAME_LENGTH}
                    value={draft}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'name-prompt-error' : undefined}
                    onChange={(event) => { setDraft(event.target.value); setError('') }}
                />
                {error && <p id="name-prompt-error" className="session-name-prompt__error" role="alert">{error}</p>}
                <button type="submit" disabled={isClosing}>Continue <span aria-hidden="true">↗</span></button>
            </form>
        </motion.dialog>
    )
}

export default InitialNamePrompt
