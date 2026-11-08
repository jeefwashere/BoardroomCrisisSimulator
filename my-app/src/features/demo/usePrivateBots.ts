import { useEffect, useState } from 'react'
import type { RoomApi, RoomSnapshot } from '../../services/rooms'
import { createFacilitationApi, FacilitationError } from '../../services/facilitation'
import { PRIVATE_POLL_MS, botPrivateStep, normalizePrivateSession, privateStatusText } from '../game/privateSessionModel'
import { DEMO_BOTS, botPrivateAnswer } from './demoModel'
import type { BotSeat, DemoBot } from './demoModel'

type Snapshots = readonly (RoomSnapshot | null)[]

// A bot "considers" each question this long before answering with its saved clip text.
const ANSWER_MS = 2500
// Morgan starts first; Sam a little later, so the two branches do not move in lock step.
const STAGGER_MS = 1800
const ERROR_RETRY_MS = 3000

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
        function stop() { clearTimeout(timer); reject(signal.reason) }
        signal.addEventListener('abort', stop, { once: true })
    })
}

export type PrivateBots = { status: Partial<Record<BotSeat, string>>; error: string }

/**
 * Solo mode, Rounds 2 and 3: Morgan and Sam each work through their own private branch with their own API client.
 * Text only: no audio is played and speech is never prepared. Each bot sends one request at a time, answers each
 * question once (saved clip caption, else a short role answer), confirms its drafted card as is, picks one choice per
 * Round 3 question, and stops when complete.
 */
export function usePrivateBots({ enabled, roomId, apis, snapshots }: { enabled: boolean; roomId: string | null; apis: readonly RoomApi[] | null; snapshots: Snapshots }): PrivateBots {
    const [status, setStatus] = useState<Partial<Record<BotSeat, string>>>({})
    const [error, setError] = useState('')
    // Both branches run while the room is in its private sessions; the loops stop when it ends (Skip phase or completion).
    const active = DEMO_BOTS.some((bot) => snapshots[bot.index]?.phase === 'private_session')

    useEffect(() => {
        if (!enabled || !roomId || !apis || !active) return
        const controller = new AbortController()
        const { signal } = controller
        const room: string = roomId
        const show = (bot: DemoBot, text: string) => setStatus((current) => current[bot.seat] === text ? current : { ...current, [bot.seat]: text })

        async function run(bot: DemoBot, api: RoomApi, delay: number) {
            const facilitation = createFacilitationApi(api)
            const handled = new Set<string>()
            const commandIds = new Map<string, string>()
            const commandId = (key: string) => {
                let id = commandIds.get(key)
                if (!id) { id = crypto.randomUUID(); commandIds.set(key, id) }
                return id
            }
            await wait(delay, signal)
            while (!signal.aborted) {
                let session
                try {
                    session = normalizePrivateSession(await facilitation.privateSession(room, signal))
                } catch (failure) {
                    if (signal.aborted) return
                    const missing = failure instanceof FacilitationError && !failure.code && (failure.status === 404 || failure.status === 405)
                    show(bot, missing ? 'private session unavailable' : 'reconnecting…')
                    await wait(missing ? 5000 : ERROR_RETRY_MS, signal)
                    continue
                }
                if (!session) { await wait(ERROR_RETRY_MS, signal); continue }
                show(bot, privateStatusText(session))
                const step = botPrivateStep(session, handled, (round) => botPrivateAnswer(bot, round), bot.index)
                if (step.kind === 'done') return
                if (step.kind === 'wait') { await wait(PRIVATE_POLL_MS, signal); continue }
                handled.add(step.key)
                try {
                    if (step.kind === 'answer') {
                        await wait(ANSWER_MS, signal)
                        await facilitation.privateAnswer(room, { command_id: commandId(step.key), text: step.text, used_clip: step.usedClip }, signal)
                    } else if (step.kind === 'choose') {
                        await wait(ANSWER_MS, signal)
                        await facilitation.privateChoice(room, { command_id: commandId(step.key), step: step.step, choice_id: step.choiceId }, signal)
                    } else if (step.kind === 'card') {
                        await wait(ANSWER_MS / 2, signal)
                        await facilitation.privateCard(room, { command_id: commandId(step.key), fields: step.fields }, signal)
                    } else {
                        await wait(ERROR_RETRY_MS, signal)
                        await facilitation.privateRetry(room, { command_id: commandId(step.key) }, signal)
                    }
                    setError('')
                } catch (failure) {
                    if (signal.aborted) return
                    // Conflicts mean the branch already moved on; anything else may be tried again with the same command ID.
                    if (!(failure instanceof FacilitationError && failure.status === 409)) handled.delete(step.key)
                    setError(`${bot.name}'s private session: ${failure instanceof Error ? failure.message : 'request failed'}`)
                    await wait(ERROR_RETRY_MS, signal)
                }
            }
        }

        DEMO_BOTS.forEach((bot, order) => { void run(bot, apis[bot.index], order * STAGGER_MS).catch(() => undefined) })
        return () => controller.abort()
    }, [enabled, roomId, apis, active])

    return { status, error }
}
