import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoomApi } from '../../services/rooms'
import type { RoomSnapshot, Scenario, StartRoomInput } from '../../services/rooms'
import { acceptSnapshot, pollRoom } from './roomState'

export const roomApi = createRoomApi()
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The room request failed. Please retry.'

export function useRoom(roomId: string) {
    const [room, setRoom] = useState<RoomSnapshot | null>(null)
    const [scenarios, setScenarios] = useState<Scenario[]>([])
    const [error, setError] = useState('')
    const [commandError, setCommandError] = useState('')
    const [starting, setStarting] = useState(false)
    const commandRef = useRef<AbortController | null>(null)
    const activeRef = useRef(false)
    const receive = useCallback((incoming: RoomSnapshot) => {
        setRoom((current) => acceptSnapshot(current, incoming))
        setError('')
    }, [])

    useEffect(() => {
        activeRef.current = true
        const controller = new AbortController()
        let stop: (() => void) | undefined
        async function connect() {
            try {
                await roomApi.initializeSession(controller.signal)
                const catalog = await roomApi.scenarios(controller.signal)
                if (controller.signal.aborted) return
                setScenarios(catalog)
                stop = pollRoom((signal) => roomApi.snapshot(roomId, signal), receive, (failure) => setError(errorMessage(failure)))
            } catch (failure) {
                if (!controller.signal.aborted) setError(errorMessage(failure))
            }
        }
        void connect()
        return () => {
            activeRef.current = false
            controller.abort()
            commandRef.current?.abort()
            stop?.()
        }
    }, [roomId, receive])

    async function start(input: StartRoomInput) {
        if (commandRef.current) return
        const controller = new AbortController()
        commandRef.current = controller
        setStarting(true)
        setCommandError('')
        try {
            const snapshot = await roomApi.start(roomId, input, controller.signal)
            if (activeRef.current && !controller.signal.aborted) { receive(snapshot); setCommandError('') }
        } catch (failure) {
            if (activeRef.current && !controller.signal.aborted) {
                setCommandError(errorMessage(failure))
                // Roster errors should recover from the current authoritative snapshot.
                try {
                    const current = await roomApi.snapshot(roomId, controller.signal)
                    if (activeRef.current && !controller.signal.aborted) receive(current)
                } catch { /* Keep the original actionable error. */ }
            }
        } finally {
            commandRef.current = null
            if (activeRef.current) setStarting(false)
        }
    }

    return { room, scenarios, error: commandError || error, starting, start }
}
