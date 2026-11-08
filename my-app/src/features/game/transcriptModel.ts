// Pure logic for the "Live transcript" side panel (no JSX, no network) so it can be unit tested.
// The call stage shows only tiles; everything spoken (briefing, turns, experts, the private coach) lands here.
import type { ExpertTake, PrivateMessage } from '../../services/facilitation.ts'
import { transitionIndex } from './privateSessionModel.ts'

export type TranscriptTone = 'agent' | 'expert' | 'coach' | 'self' | 'member' | 'system'

/** Progressive reveal: the text types out from `startedAt` over `durationMs` (the audio's length). */
export type Reveal = { startedAt: number; durationMs: number }

export type TranscriptEntry = {
    id: string
    speaker: string
    /** Short tag beside the name ("AI agent", "Expert", "You", the member's scenario role). */
    role: string
    tone: TranscriptTone
    text: string
    /** Optional accent colour for the speaker name (experts). */
    accent?: string
    /** The line is being spoken right now ("Speaking" dot). */
    live: boolean
    /** Null shows the full text at once. */
    reveal: Reveal | null
}

export type TranscriptInput = Omit<TranscriptEntry, 'live' | 'reveal'>

export type TranscriptAction =
    | { type: 'upsert'; entry: TranscriptInput }
    | { type: 'speak'; entry: TranscriptInput; at: number; durationMs: number | null }
    | { type: 'done'; id: string }
    | { type: 'clear' }

/** Oldest lines drop off beyond this, so a long game never grows the panel without bound. */
export const MAX_TRANSCRIPT_ENTRIES = 300
/** Roughly the pace of spoken ElevenLabs speech; used when an audio length is unknown. */
export const SPEECH_CHARS_PER_SECOND = 15
export const CAPTIONS_STORAGE_KEY = 'boardroom.captions'

function sameInput(entry: TranscriptEntry, input: TranscriptInput): boolean {
    return entry.speaker === input.speaker && entry.role === input.role && entry.tone === input.tone && entry.text === input.text && entry.accent === input.accent
}

function capped(entries: TranscriptEntry[]): TranscriptEntry[] {
    return entries.length > MAX_TRANSCRIPT_ENTRIES ? entries.slice(entries.length - MAX_TRANSCRIPT_ENTRIES) : entries
}

/**
 * Transcript state transitions. `upsert` adds a line with its full text (or updates an existing line's text in place,
 * keeping its position). `speak` adds or updates a line and starts revealing it in time with its audio; only one line
 * is live at a time. `done` ends the live state and shows the whole line. Unchanged input returns the same array.
 */
export function transcriptReducer(state: TranscriptEntry[], action: TranscriptAction): TranscriptEntry[] {
    switch (action.type) {
        case 'upsert': {
            const index = state.findIndex((entry) => entry.id === action.entry.id)
            if (index === -1) return capped([...state, { ...action.entry, live: false, reveal: null }])
            if (sameInput(state[index], action.entry)) return state
            return state.map((entry, position) => position === index ? { ...entry, ...action.entry } : entry)
        }
        case 'speak': {
            const reveal = action.durationMs !== null && action.durationMs > 0 ? { startedAt: action.at, durationMs: action.durationMs } : null
            const ended = state.map((entry) => entry.live && entry.id !== action.entry.id ? { ...entry, live: false, reveal: null } : entry)
            const index = ended.findIndex((entry) => entry.id === action.entry.id)
            const next: TranscriptEntry = { ...action.entry, live: true, reveal }
            if (index === -1) return capped([...ended, next])
            return ended.map((entry, position) => position === index ? next : entry)
        }
        case 'done': {
            const index = state.findIndex((entry) => entry.id === action.id)
            if (index === -1 || (!state[index].live && !state[index].reveal)) return state
            return state.map((entry, position) => position === index ? { ...entry, live: false, reveal: null } : entry)
        }
        case 'clear':
            return state.length ? [] : state
    }
}

/** Estimated speaking time for text without a known audio length. */
export function estimateSpeechMs(text: string, charsPerSecond = SPEECH_CHARS_PER_SECOND): number {
    return Math.round((text.length / Math.max(1, charsPerSecond)) * 1000)
}

/** Reveal length for an audio element or clip duration in seconds; falls back to the estimate when unknown. */
export function speechDurationMs(seconds: number | null | undefined, text: string): number {
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : estimateSpeechMs(text)
}

/**
 * How long a line without audio holds the floor before the next one starts (the stage moves on silently).
 * Roughly its speaking time plus a short pause, optionally capped so silent sessions do not drag.
 */
export function silentHoldMs(text: string, charsPerSecond: number, pauseMs: number, maxMs = Number.POSITIVE_INFINITY): number {
    return Math.min(maxMs, estimateSpeechMs(text, charsPerSecond) + pauseMs)
}

/** Characters of `text` revealed at `now`; the whole text without a reveal or once its time is up. */
export function revealedLength(text: string, reveal: Reveal | null, now: number): number {
    if (!reveal || reveal.durationMs <= 0) return text.length
    const ratio = (now - reveal.startedAt) / reveal.durationMs
    if (ratio >= 1) return text.length
    if (ratio <= 0) return 0
    return Math.min(text.length, Math.ceil(text.length * ratio))
}

/** The revealed prefix, cut at the end of the last whole word so captions never show half a word. */
export function revealedText(text: string, reveal: Reveal | null, now: number): string {
    const count = revealedLength(text, reveal, now)
    if (count >= text.length) return text
    const prefix = text.slice(0, count)
    if (/\s/.test(text[count] ?? '')) return prefix
    const cut = prefix.search(/\s\S*$/)
    return cut === -1 ? '' : prefix.slice(0, cut)
}

/** Captions default to on; only an explicit "0" stored for this tab turns them off. */
export function captionsPreference(raw: string | null | undefined): boolean {
    return raw !== '0'
}

// Entry builders: stable IDs per spoken line, so repeated renders update one line instead of adding another.

export function briefingEntry(opening: { speech_id: string | null; text: string }): TranscriptInput {
    return { id: `opening:${opening.speech_id ?? opening.text.length}`, speaker: 'Preparation agent', role: 'AI agent', tone: 'agent', text: opening.text }
}

export function expertEntry(roundId: string, take: Pick<ExpertTake, 'kind' | 'label' | 'text'>, accent?: string): TranscriptInput {
    return { id: `expert:${roundId}:${take.kind}`, speaker: take.label, role: 'Expert', tone: 'expert', text: take.text, ...(accent ? { accent } : {}) }
}

export function turnEntry(turn: string, member: { name: string; role: string }, text: string, self: boolean): TranscriptInput {
    return { id: `turn:${turn}`, speaker: self ? `${member.name} (you)` : member.name, role: member.role, tone: self ? 'self' : 'member', text }
}

export function privateAgentName(agentName: string, round: number): string {
    return round === 3 ? `${agentName} · examiner` : agentName
}

/** One private session message as a transcript line: the coach's lines, the member's answers, failures as notes. */
export function privateEntry(message: Pick<PrivateMessage, 'message_id' | 'author' | 'round' | 'status' | 'text'>, agentName: string, selfName: string): TranscriptInput {
    const id = `private:${message.message_id}`
    if (message.author === 'member') return { id, speaker: `${selfName} (you)`, role: message.round === 3 ? 'Answer' : 'You', tone: 'self', text: message.text }
    if (message.status === 'failed') return { id, speaker: privateAgentName(agentName, message.round), role: 'Note', tone: 'system', text: message.text || 'This reply could not be prepared.' }
    return { id, speaker: privateAgentName(agentName, message.round), role: message.round === 3 ? 'Examiner' : 'Crisis coach', tone: 'coach', text: message.text }
}

export function privateAutoEntry(key: string, selfName: string, text: string): TranscriptInput {
    return { id: `private-auto:${key}`, speaker: `${selfName} (you)`, role: 'Saved answer', tone: 'self', text }
}

export function assessmentDividerEntry(agentName: string): TranscriptInput {
    return { id: 'private:round3-divider', speaker: 'Round 3 · Assessment begins', role: 'Scored', tone: 'system', text: `Your preparation is complete. ${agentName} is now your examiner and only Round 3 answers earn points.` }
}

/**
 * Private session lines to show (in full) for the messages revealed so far: everything up to `upTo` except the line
 * being voiced now (`currentId`, which is spoken in step with its audio) and pending replies. The Round 3 hand over
 * gets a divider line. Member answers whose text was already captioned from an Auto response clip are skipped.
 */
export function privateTranscriptLines(messages: readonly PrivateMessage[], upTo: number, currentId: string | null, agentName: string, selfName: string,
    captioned: ReadonlySet<string> = new Set()): TranscriptInput[] {
    const handover = transitionIndex(messages)
    const lines: TranscriptInput[] = []
    messages.slice(0, upTo).forEach((message, index) => {
        if (index === handover && handover > 0) lines.push(assessmentDividerEntry(agentName))
        if (message.message_id === currentId || message.status === 'pending') return
        if (message.author === 'member' && captioned.has(message.text.trim())) return
        lines.push(privateEntry(message, agentName, selfName))
    })
    return lines
}
