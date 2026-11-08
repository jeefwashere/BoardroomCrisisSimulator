import { useEffect, useRef, useState } from 'react'
import { RoomApiError } from '../../services/rooms'
import type { RoomApi, RoomSnapshot } from '../../services/rooms'
import { createFacilitationApi } from '../../services/facilitation'
import type { RecordedClip } from '../../services/facilitation'
import { clipForTurn } from '../game/savedClips'
import { botDecisionStep, botSpeakingTurn, botVoteChoice, nextBotAction, turnBudgetMs } from './demoModel'
import type { BotAction, BotActivity, BotSeat } from './demoModel'

type Snapshots = readonly (RoomSnapshot | null)[]

// The board "thinks" this long before each bot ballot, so the votes land one after another.
const DECIDE_MS = 1500
// Each bot "writes" its individual decision this long, so Morgan and Sam submit one after another.
const WRITE_MS = 3500
// Silent stand in for a clip that is missing or that the browser refused to autoplay.
const FALLBACK_MS = 2000
// Server answers meaning the turn or vote already moved on; nothing to report or retry.
const MOVED_ON = new Set(['stale_phase', 'not_speaking', 'speaker_required', 'not_voting', 'not_deciding', 'game_ended'])

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return }
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
        function stop() { clearTimeout(timer); reject(signal.reason) }
        signal.addEventListener('abort', stop, { once: true })
    })
}

/** Plays a clip to the end (or until the turn budget runs out). 'blocked' means autoplay or loading failed. */
function playClip(url: string, budgetMs: number, signal: AbortSignal): Promise<'played' | 'blocked'> {
    return new Promise((resolve, reject) => {
        const audio = new Audio(url)
        let settled = false
        const finish = (outcome: 'played' | 'blocked' | 'aborted') => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            audio.pause()
            audio.removeAttribute('src')
            audio.load()
            if (outcome === 'aborted') reject(signal.reason)
            else resolve(outcome)
        }
        const abort = () => finish('aborted')
        const timer = setTimeout(() => finish('played'), budgetMs)
        signal.addEventListener('abort', abort, { once: true })
        audio.addEventListener('ended', () => finish('played'), { once: true })
        audio.addEventListener('error', () => finish('blocked'), { once: true })
        audio.play().catch(() => finish('blocked'))
    })
}

function stillSpeaking(snapshot: RoomSnapshot | null, action: BotAction): boolean {
    return botSpeakingTurn(action.bot, snapshot)?.phaseId === action.phaseId
}

export type SoloBots = { activity: Partial<Record<BotSeat, BotActivity>>; error: string }

/**
 * Drives Morgan and Sam in solo mode through their own room API clients:
 * plays each bot's saved clip on its turn, commits the caption and passes,
 * then votes once the CEO has voted, or writes its own decision in individual
 * decision games. One bot action runs at a time; each action key (phase and
 * bot) runs at most once, and a retried decision reuses its command ID.
 */
export function useSoloBots({ enabled, roomId, apis, snapshots, onSnapshot }: {
    enabled: boolean
    roomId: string | null
    /** Seat clients in DEMO_SEATS order (Alex, Morgan, Sam). */
    apis: readonly RoomApi[] | null
    snapshots: Snapshots
    onSnapshot: (index: number, snapshot: RoomSnapshot) => void
}): SoloBots {
    const [activity, setActivity] = useState<Partial<Record<BotSeat, BotActivity>>>({})
    const [error, setError] = useState('')
    // Bumped after each action so the driver re-checks without waiting for the next poll.
    const [kick, setKick] = useState(0)
    const [catalog, setCatalog] = useState<{ roomId: string; clips: RecordedClip[] } | null>(null)
    const latest = useRef(snapshots)
    const handled = useRef(new Set<string>())
    // Stable command IDs per action key, so a retried submission is idempotent on the server.
    const commandIds = useRef(new Map<string, string>())
    const running = useRef<{ action: BotAction; controller: AbortController } | null>(null)
    const onSnapshotRef = useRef(onSnapshot)

    useEffect(() => { latest.current = snapshots; onSnapshotRef.current = onSnapshot })

    // A new room (or leaving solo mode) forgets past actions and stops anything in flight.
    useEffect(() => {
        handled.current = new Set()
        commandIds.current = new Map()
        return () => { running.current?.controller.abort(); running.current = null }
    }, [enabled, roomId, apis])

    useEffect(() => {
        if (!enabled || !roomId || !apis) return
        const controller = new AbortController()
        createFacilitationApi(apis[0]).recordings(controller.signal).then(
            (clips) => setCatalog({ roomId, clips: Array.isArray(clips) ? clips : [] }),
            () => { if (!controller.signal.aborted) setCatalog({ roomId, clips: [] }) },
        )
        return () => controller.abort()
    }, [enabled, roomId, apis])

    // Stop a bot's clip as soon as its turn ends some other way (Skip phase, timeout).
    useEffect(() => {
        const current = running.current
        if (current?.action.kind === 'speak' && !stillSpeaking(snapshots[current.action.bot.index], current.action)) current.controller.abort()
    }, [snapshots])

    useEffect(() => {
        if (!enabled || !roomId || !apis || running.current) return
        const next = nextBotAction(snapshots, handled.current)
        if (!next) return
        // Narrowed constants for the async steps below.
        const action: BotAction = next
        const room: string = roomId
        const clips = catalog?.roomId === roomId ? catalog.clips : null
        if (action.kind === 'speak' && clips === null) return // The catalog is still loading; the next poll retries.
        handled.current.add(action.key)
        const controller = new AbortController()
        running.current = { action, controller }
        const { bot } = action
        const api = apis[bot.index]
        const show = (value: BotActivity | null) => setActivity((current) => ({ ...current, [bot.seat]: value ?? undefined }))
        const { signal } = controller

        async function speak() {
            const own = latest.current[bot.index]
            if (!own?.game) return
            // Looped speaking orders give each of the bot's turns its own discussion clip.
            const clip = clipForTurn(own.game, clips ?? [], own.self_member_id)
            const text = clip?.text.trim() || bot.fallback
            show(clip ? 'clip' : 'fallback')
            const outcome = clip ? await playClip(createFacilitationApi(api).recordingUrl(clip), turnBudgetMs(own.game), signal) : 'blocked'
            if (outcome === 'blocked') {
                show('fallback')
                await wait(FALLBACK_MS, signal)
            }
            if (!stillSpeaking(latest.current[bot.index], action)) return
            show('committing')
            await api.command(room, 'contributions', { command_id: crypto.randomUUID(), phase_id: action.phaseId, kind: 'answer', source: 'typed', text }, signal)
            if (!stillSpeaking(latest.current[bot.index], action)) return
            const after = await api.command(room, `rounds/${action.roundId}/speaker/finish`, { command_id: crypto.randomUUID(), phase_id: action.phaseId }, signal)
            onSnapshotRef.current(bot.index, after)
        }

        async function vote() {
            show('deciding')
            await wait(DECIDE_MS, signal)
            const ceo = latest.current[0]
            const own = latest.current[bot.index]
            if (ceo?.phase !== 'voting' || own?.phase !== 'voting' || own.game.phase_id !== action.phaseId || own.game.self_vote != null) return
            // Alex's view lists a custom option Alex just added even if this bot's last poll predates it.
            const options = ceo.game.current_node?.options ?? own.game.current_node?.options ?? []
            const choice = botVoteChoice({ bot, options, ceoVote: ceo.game.self_vote, ceoMemberId: ceo.self_member_id, roomId: room })
            if (!choice) return
            const after = await api.command(room, `rounds/${action.roundId}/vote`, { command_id: crypto.randomUUID(), phase_id: action.phaseId, option_id: choice }, signal)
            onSnapshotRef.current(bot.index, after)
        }

        async function decide() {
            show('writing')
            await wait(WRITE_MS, signal)
            if (botDecisionStep(bot, latest.current[bot.index])?.phaseId !== action.phaseId) return
            let commandId = commandIds.current.get(action.key)
            if (!commandId) { commandId = crypto.randomUUID(); commandIds.current.set(action.key, commandId) }
            const after = await api.command(room, `rounds/${action.roundId}/decision`, { command_id: commandId, phase_id: action.phaseId, text: bot.decision }, signal)
            onSnapshotRef.current(bot.index, after)
        }

        void (action.kind === 'speak' ? speak() : action.kind === 'decide' ? decide() : vote()).then(() => setError(''), (failure: unknown) => {
            if (signal.aborted) return
            if (failure instanceof RoomApiError && MOVED_ON.has(failure.code)) return
            // A ballot or decision can safely be tried again on the next poll; a spoken turn is not replayed.
            if (action.kind !== 'speak') handled.current.delete(action.key)
            const verb = action.kind === 'vote' ? 'vote' : action.kind === 'decide' ? 'submit a decision' : 'finish the turn'
            setError(`${bot.name} could not ${verb}: ${failure instanceof Error ? failure.message : 'request failed'}`)
        }).finally(() => {
            if (running.current?.controller === controller) running.current = null
            show(null)
            setKick((value) => value + 1)
        })
    }, [enabled, roomId, apis, snapshots, catalog, kick])

    return { activity, error }
}
