import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomApiError } from '../../services/rooms'
import type { RoomSnapshot } from '../../services/rooms'
import { errorMessage, roomApi } from './useRoom'
import { deferLinkedJoin, linkedJoinKey, roomEntryIntent } from './directEntry'
import type { EntryIntent, EntryMode } from './directEntry'

type EntryOptions = {
    name: string
    roomCode: string
    ready: boolean
    initialEntry?: EntryMode
    onEnter: (room: RoomSnapshot) => void
}

export function useRoomEntry({ name, roomCode, ready, initialEntry, onEnter }: EntryOptions) {
    const [busy, setBusy] = useState<EntryMode | null>(null)
    const [error, setError] = useState('')
    const [role, setRole] = useState('')
    const [lateJoin, setLateJoin] = useState<{ code: string; roles: { role_id: string; name: string }[] } | null>(null)
    const requestRef = useRef<AbortController | null>(null)
    const intentRef = useRef<EntryIntent | null>(null)
    const attemptedLinks = useRef(new Set<string>())
    const code = roomCode.trim().toUpperCase()
    const needsRole = lateJoin?.code === code
    const hasRoles = Boolean(lateJoin?.roles.length)

    useEffect(() => () => requestRef.current?.abort(), [])

    const submit = useCallback(async (mode: EntryMode) => {
        if (requestRef.current || !name || !ready) return
        if (mode === 'join' && !/^[A-Z0-9]{6}$/.test(code)) {
            setError('Enter a six character room code using letters and numbers.')
            return
        }
        if (mode === 'join' && needsRole && hasRoles && !role) {
            setError('Choose a role to join this game.')
            return
        }

        const controller = new AbortController()
        requestRef.current = controller
        setBusy(mode)
        setError('')
        intentRef.current = roomEntryIntent(intentRef.current, mode, name, code, mode === 'join' && needsRole ? role : '')
        try {
            await roomApi.initializeSession(controller.signal)
            const room = await (mode === 'host' ? roomApi.create(intentRef.current.body, controller.signal) : roomApi.join(intentRef.current.body, controller.signal))
            if (!controller.signal.aborted) onEnter(room)
        } catch (failure) {
            if (controller.signal.aborted) return
            setError(errorMessage(failure))
            if (failure instanceof RoomApiError) {
                if (mode === 'host' && failure.code === 'room_code_taken') intentRef.current = null
                if (mode === 'join' && failure.code === 'role_not_yet_allowed') { setRole(''); setLateJoin(null) }
                if (mode === 'join' && failure.code === 'invalid_role') {
                    setLateJoin({ code, roles: [] })
                    try {
                        const scenarios = await roomApi.scenarios(controller.signal)
                        const roles = [...new Map(scenarios.flatMap((scenario) => scenario.roles).filter((option) => option.role_id !== 'ceo').map((option) => [option.role_id, option])).values()]
                        if (!controller.signal.aborted) setLateJoin({ code, roles })
                    } catch (catalogError) {
                        if (!controller.signal.aborted) setError(errorMessage(catalogError))
                    }
                }
            }
        } finally {
            if (!controller.signal.aborted) { requestRef.current = null; setBusy(null) }
        }
    }, [name, ready, code, needsRole, hasRoles, role, onEnter])

    // Old /host and invitation URLs use the same menu flow, with no confirmation page.
    const automaticKey = ready && initialEntry
        ? initialEntry === 'host' && name.trim() ? JSON.stringify(['host', name]) : linkedJoinKey(initialEntry, code, name)
        : null
    useEffect(() => deferLinkedJoin(automaticKey, attemptedLinks.current, () => {
        if (initialEntry) void submit(initialEntry)
    }), [automaticKey, initialEntry, submit])

    return { busy, error, submit, needsRole, roles: lateJoin?.roles ?? [], role, setRole, clearError: () => setError('') }
}
