import { useEffect, useId, useRef, useState } from 'react'
import '../../pages/Home.css'
import './SessionClosure.css'

export default function HostLeavePrompt({ onYes, onNo }: { onYes: () => Promise<void>; onNo: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const noRef = useRef<HTMLButtonElement>(null)
    const pendingRef = useRef(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const titleId = useId()
    const messageId = useId()
    useEffect(() => {
        const dialog = dialogRef.current
        dialog?.showModal()
        noRef.current?.focus()
        return () => { if (dialog?.open) dialog.close() }
    }, [])
    async function confirm() {
        if (pendingRef.current) return
        pendingRef.current = true
        setBusy(true)
        setError('')
        try { await onYes() }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'The session could not be ended. Please try again.') }
        finally { pendingRef.current = false; setBusy(false) }
    }
    return <dialog ref={dialogRef} className="host-leave-prompt" aria-labelledby={titleId} aria-describedby={messageId} aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!pendingRef.current) onNo() }}>
        <h2 id={titleId}>End this call?</h2>
        <p id={messageId}>Leaving will end the call and disconnect everyone. Are you sure?</p>
        {error && <p className="host-leave-prompt__error" role="alert">{error}</p>}
        <div className="host-leave-prompt__actions">
            <button className="home-menu__button" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? 'Ending…' : 'Yes'}</button>
            <button ref={noRef} className="home-menu__button" type="button" disabled={busy} onClick={onNo}>No</button>
        </div>
    </dialog>
}
