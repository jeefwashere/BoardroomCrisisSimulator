// Pure helpers for Rounds 2 and 3 (private coaching, then private assessment). No JSX, no network, so they can be unit tested.
import type {
    Assessment, AssessmentStage, CardFieldKey, CriterionFeedback, PrivateClip, PrivateMessage, PrivateQuiz, PrivateRound, PrivateSession, PrivateStage,
    ResponseCard, ResponseCardFields, StageFeedback,
} from '../../services/facilitation.ts'
import type { PrivateProgress, PrivateProgressStage } from '../../services/rooms.ts'
import { botChoice, currentQuestion, normalizeQuiz, quizStatusText } from './quizModel.ts'

export const PRIVATE_POLL_MS = 1200
export const ANSWER_LIMIT = 1200
export const CARD_FIELD_LIMIT = 600
/** What the coach writes for a detail the member has not settled yet. */
export const NEEDS_CONFIRMATION = 'Needs confirmation'

/** The seven response card fields, in the order the design lists them. */
export const CARD_FIELDS: readonly { key: CardFieldKey; label: string; hint: string }[] = [
    { key: 'action', label: 'Action', hint: 'What you intend to do' },
    { key: 'responsibility', label: 'Responsibility', hint: 'Who acts and who authorizes' },
    { key: 'evidence', label: 'Evidence', hint: 'What supports this response' },
    { key: 'dependencies', label: 'Dependencies', hint: 'What must be available first' },
    { key: 'fallback', label: 'Fallback', hint: 'What happens if the action cannot proceed' },
    { key: 'communication', label: 'Communication', hint: 'Who needs an update and what to tell them' },
    { key: 'review', label: 'Review', hint: 'When progress will be checked' },
]

/** Round 3 stages and their maxima (30, 40, 30). */
export const ASSESSMENT_STAGES: readonly { step: number; max: number; title: string }[] = [
    { step: 1, max: 30, title: 'Explain your decision' },
    { step: 2, max: 40, title: 'Respond to a challenge' },
    { step: 3, max: 30, title: 'Give your final instruction' },
]

const STAGES: readonly PrivateStage[] = ['coaching', 'card', 'assessment', 'complete']
const KINDS: readonly PrivateMessage['kind'][] = ['twist', 'question', 'ack', 'update', 'transition', 'answer', 'result']
const SOURCES: readonly NonNullable<PrivateMessage['source']>[] = ['vertex', 'hosted', 'offline', 'canonical']
const STAGE_STATUSES: readonly AssessmentStage['status'][] = ['waiting', 'scoring', 'scored', 'failed']

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const nullableText = (value: unknown): string | null => typeof value === 'string' ? value : null
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
const round = (value: unknown, fallback: PrivateRound): PrivateRound => value === 2 || value === 3 ? value : fallback
function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
    return options.includes(value as T) ? value as T : fallback
}

export function emptyCardFields(): ResponseCardFields {
    return { action: '', responsibility: '', evidence: '', dependencies: '', fallback: '', communication: '', review: '' }
}

export function defaultAssessment(): Assessment {
    return { stages: ASSESSMENT_STAGES.map(({ step, max }) => ({ step, max, points: null, status: 'waiting' })), total: null, max: 100, feedback: null }
}

function message(value: unknown, index: number): PrivateMessage | null {
    if (!record(value) || typeof value.text !== 'string') return null
    const author = value.author === 'member' ? 'member' : value.author === 'agent' ? 'agent' : null
    if (!author) return null
    return {
        message_id: typeof value.message_id === 'string' && value.message_id ? value.message_id : `message-${index}`,
        author,
        kind: oneOf(value.kind, KINDS, author === 'member' ? 'answer' : 'update'),
        round: round(value.round, 2),
        step: integer(value.step),
        text: value.text,
        status: oneOf(value.status, ['pending', 'ready', 'failed'] as const, 'ready'),
        source: SOURCES.includes(value.source as never) ? value.source as PrivateMessage['source'] : null,
        speech_id: typeof value.speech_id === 'string' && value.speech_id ? value.speech_id : null,
        at: text(value.at),
    }
}

function card(value: unknown): ResponseCard | null {
    if (!record(value)) return null
    const fields = emptyCardFields()
    if (record(value.fields)) for (const { key } of CARD_FIELDS) fields[key] = text(value.fields[key])
    return { status: oneOf(value.status, ['drafting', 'draft', 'confirmed'] as const, 'drafting'), fields }
}

function criterion(value: unknown): CriterionFeedback | null {
    if (!record(value)) return null
    return { id: text(value.id), label: text(value.label) || text(value.id).replaceAll('_', ' '), max: integer(value.max) ?? 10, points: integer(value.points) ?? 0, reason: text(value.reason), quote: text(value.quote) }
}

function assessment(value: unknown): Assessment {
    const fallback = defaultAssessment()
    if (!record(value)) return fallback
    const stages = Array.isArray(value.stages) ? value.stages.filter(record).map((stage, index): AssessmentStage => ({
        step: integer(stage.step) ?? index + 1,
        max: integer(stage.max) ?? ASSESSMENT_STAGES[index]?.max ?? 0,
        points: integer(stage.points),
        status: oneOf(stage.status, STAGE_STATUSES, 'waiting'),
    })) : []
    const feedback = Array.isArray(value.feedback) ? value.feedback.filter(record).map((item, index): StageFeedback => ({
        step: integer(item.step) ?? index + 1,
        criteria: Array.isArray(item.criteria) ? item.criteria.map(criterion).filter((entry): entry is CriterionFeedback => entry !== null) : [],
    })) : null
    return { stages: stages.length ? stages : fallback.stages, total: integer(value.total), max: integer(value.max) ?? 100, feedback }
}

function clip(value: unknown): PrivateClip | null {
    if (!record(value) || typeof value.audio_url !== 'string' || !value.audio_url || typeof value.text !== 'string' || !value.text.trim()) return null
    return { clip_id: text(value.clip_id) || value.audio_url, audio_url: value.audio_url, text: value.text, duration_seconds: integer(value.duration_seconds) }
}

/** Reads a private session payload defensively; a payload without a known stage or a message list is rejected (null). */
export function normalizePrivateSession(value: unknown): PrivateSession | null {
    if (!record(value) || !STAGES.includes(value.stage as PrivateStage) || !Array.isArray(value.messages)) return null
    const stage = value.stage as PrivateStage
    const messages = value.messages.map(message).filter((entry): entry is PrivateMessage => entry !== null)
    const expecting = record(value.expecting) && typeof value.expecting.question === 'string'
        ? { round: round(value.expecting.round, stage === 'coaching' ? 2 : 3), step: integer(value.expecting.step) ?? 1, question: value.expecting.question }
        : null
    const agent = record(value.agent) ? value.agent : {}
    return {
        round: round(value.round, stage === 'coaching' || stage === 'card' ? 2 : 3),
        stage,
        agent: { label: text(agent.label) || 'Crisis coach', role: agent.role === 'examiner' ? 'examiner' : 'coach' },
        decision_text: nullableText(value.decision_text),
        messages,
        expecting,
        busy: value.busy === true,
        clip: clip(value.clip),
        card: card(value.card),
        assessment: assessment(value.assessment),
        quiz: normalizeQuiz(value.quiz),
        retryable: value.retryable === true,
    }
}

/** Keep polling while the coach is working: busy, a reply still pending, a card being drafted, a stage being scored or questions being written. */
export function shouldPollPrivate(session: PrivateSession | null): boolean {
    if (!session) return true
    return session.busy || session.messages.some((item) => item.status === 'pending') || session.card?.status === 'drafting'
        || session.assessment.stages.some((stage) => stage.status === 'scoring') || session.quiz?.status === 'generating'
}

/** The member's own round: from the session when loaded, else from the room's progress list. */
export function ownPrivateRound(session: Pick<PrivateSession, 'round'> | null, progress: readonly PrivateProgress[] | null | undefined, selfId: string): PrivateRound {
    if (session) return session.round
    const stage = progress?.find((item) => item.member_id === selfId)?.stage
    return stage === 'assessment' || stage === 'complete' ? 3 : 2
}

export function privateRoundLabel(round: PrivateRound): string {
    return round === 3 ? 'Round 3 · Assessment' : 'Round 2 · Private coaching'
}

/** Cumulative Round 3 points: the server total when given, else the sum of scored stages. */
export function runningScore(value: Assessment): number {
    if (value.total !== null) return value.total
    return value.stages.reduce((sum, stage) => sum + (stage.status === 'scored' && stage.points !== null ? stage.points : 0), 0)
}

export function scoreText(value: Assessment): string {
    return `Score ${runningScore(value)} / ${value.max || 100}`
}

export type StageChip = { step: number; max: number; title: string; text: string; status: AssessmentStage['status'] }

/** Three chips (30/40/30); points appear once a stage is scored. */
export function stageChips(value: Assessment): StageChip[] {
    return value.stages.map((stage) => {
        const title = ASSESSMENT_STAGES.find((item) => item.step === stage.step)?.title ?? `Stage ${stage.step}`
        const points = stage.status === 'scored' && stage.points !== null ? String(stage.points) : stage.status === 'scoring' ? '…' : '–'
        return { step: stage.step, max: stage.max, title, text: `${points} / ${stage.max}`, status: stage.status }
    })
}

/** Stage heading for detailed feedback, with that stage's points. */
export function feedbackHeading(feedback: StageFeedback, value: Assessment): string {
    const stage = value.stages.find((item) => item.step === feedback.step)
    const title = ASSESSMENT_STAGES.find((item) => item.step === feedback.step)?.title ?? 'Assessment'
    const points = stage?.points ?? feedback.criteria.reduce((sum, item) => sum + item.points, 0)
    const max = stage?.max ?? feedback.criteria.reduce((sum, item) => sum + item.max, 0)
    return `Stage ${feedback.step} · ${title} · ${points} / ${max}`
}

/**
 * Agent messages that should not be replayed when the stage first opens: everything before the member's latest answer.
 * A fresh session therefore voices its twist and first question; a reload only voices the current question.
 * In the Round 3 quiz (picks are not member messages) everything before the current question is treated as heard,
 * and a finished quiz replays nothing.
 */
export function initiallySpoken(messages: readonly PrivateMessage[], quiz: PrivateQuiz | null = null): Set<string> {
    let lastAnswer = -1
    messages.forEach((item, index) => { if (item.author === 'member') lastAnswer = index })
    if (quiz?.status === 'ready') {
        const current = currentQuestion(quiz)
        const asked = current ? messages.findLastIndex((item) => item.author === 'agent' && item.kind === 'question' && item.round === 3 && item.step === current.step) : -1
        if (asked >= 0) lastAnswer = Math.max(lastAnswer, asked - 1)
        else if (!current && quiz.questions.length > 0 && quiz.questions.every((item) => item.chosen !== null)) lastAnswer = messages.length - 1
    }
    return new Set(messages.slice(0, lastAnswer + 1).filter((item) => item.author === 'agent').map((item) => item.message_id))
}

/** The next agent message to type out and voice, in order: the first one not yet spoken. Failed replies are skipped. */
export function nextToSpeak(messages: readonly PrivateMessage[], spoken: ReadonlySet<string>): PrivateMessage | null {
    for (const item of messages) {
        if (item.author !== 'agent' || spoken.has(item.message_id) || item.status === 'failed') continue
        return item
    }
    return null
}

/** The short wording of the question awaiting an answer (the transcript already shows any development before it). */
export function questionText(session: Pick<PrivateSession, 'expecting' | 'messages'>): string {
    const expecting = session.expecting
    if (!expecting) return ''
    const asked = session.messages.findLast((item) => item.author === 'agent' && item.kind === 'question' && item.round === expecting.round && item.step === expecting.step)
    return asked?.text || expecting.question
}

/** Index of the explicit hand over from coach to examiner (the transition message, else the first Round 3 message). */
export function transitionIndex(messages: readonly PrivateMessage[]): number {
    const explicit = messages.findIndex((item) => item.kind === 'transition')
    return explicit >= 0 ? explicit : messages.findIndex((item) => item.round === 3)
}

export function canSubmitAnswer(value: string): boolean {
    const clean = value.trim()
    return clean.length > 0 && clean.length <= ANSWER_LIMIT
}

/** A card can be confirmed when every field has text within the limit (the server requires all seven). */
export function canConfirmCard(fields: ResponseCardFields): boolean {
    return CARD_FIELDS.every(({ key }) => fields[key].trim().length > 0 && fields[key].trim().length <= CARD_FIELD_LIMIT)
}

export function trimCard(fields: ResponseCardFields): ResponseCardFields {
    const clean = emptyCardFields()
    for (const { key } of CARD_FIELDS) clean[key] = fields[key].trim()
    return clean
}

/** Stable key for the question currently awaiting an answer. */
export function expectingKey(session: Pick<PrivateSession, 'expecting'> | null): string | null {
    return session?.expecting ? `${session.expecting.round}:${session.expecting.step}` : null
}

function clampStep(step: number): number {
    return Math.min(3, Math.max(1, step))
}

/** Short progress text for one branch: "coaching 2/3", "response card", "assessment 1/3", "complete". */
export function privateStatusText(session: PrivateSession): string {
    if (session.stage === 'complete') return 'complete'
    if (session.stage === 'card') return 'response card'
    if (session.stage === 'assessment' && session.quiz) return quizStatusText(session.quiz)
    if (session.stage === 'assessment') {
        const done = session.assessment.stages.filter((stage) => stage.status === 'scored' || stage.status === 'scoring').length
        return `assessment ${clampStep(session.expecting?.round === 3 ? session.expecting.step : done + 1)}/3`
    }
    const answered = session.messages.filter((item) => item.author === 'member' && item.round === 2).length
    return `coaching ${clampStep(session.expecting?.round === 2 ? session.expecting.step : answered + 1)}/3`
}

const PROGRESS_TEXT: Readonly<Record<PrivateProgressStage, string>> = {
    not_started: 'Not started', coaching: 'Private coaching', card: 'Response card', assessment: 'Assessment', complete: 'Complete',
}

export function progressText(stage: PrivateProgressStage): string {
    return PROGRESS_TEXT[stage] ?? 'Not started'
}

/** Short lower case progress for the solo Board strip when no session has been read yet. */
export function progressStatus(stage: PrivateProgressStage | undefined): string {
    if (!stage || stage === 'not_started') return 'starting…'
    return stage === 'card' ? 'response card' : stage
}

export function allComplete(progress: readonly PrivateProgress[] | null | undefined): boolean {
    return Boolean(progress?.length) && progress!.every((item) => item.stage === 'complete')
}

export type BotPrivateStep =
    | { kind: 'done' }
    | { kind: 'wait' }
    | { kind: 'retry'; key: string }
    | { kind: 'answer'; key: string; text: string; usedClip: boolean }
    | { kind: 'card'; key: string; fields: ResponseCardFields }
    | { kind: 'choose'; key: string; step: number; choiceId: string }

/**
 * What an automated board member does next in its own branch. It answers each question once (its saved clip, else
 * `fallback`), confirms the drafted card as is, picks one choice per Round 3 question (spread by `seed`), retries a
 * failed reply once per failure, and otherwise waits.
 */
export function botPrivateStep(session: PrivateSession, handled: ReadonlySet<string>, fallback: (round: PrivateRound, step: number) => string, seed = 0): BotPrivateStep {
    if (session.stage === 'complete') return { kind: 'done' }
    if (session.busy) return { kind: 'wait' }
    if (session.retryable) {
        const key = `retry:${session.messages.length}:${session.stage}`
        return handled.has(key) ? { kind: 'wait' } : { kind: 'retry', key }
    }
    if (shouldPollPrivate(session)) return { kind: 'wait' }
    const question = session.stage === 'assessment' ? currentQuestion(session.quiz) : null
    if (question) {
        const key = `choice:${question.step}`
        const choiceId = botChoice(question, seed)
        return handled.has(key) || !choiceId ? { kind: 'wait' } : { kind: 'choose', key, step: question.step, choiceId }
    }
    if (session.expecting) {
        const key = `answer:${session.expecting.round}:${session.expecting.step}`
        if (handled.has(key)) return { kind: 'wait' }
        const saved = session.clip?.text.trim()
        return { kind: 'answer', key, text: saved || fallback(session.expecting.round, session.expecting.step), usedClip: Boolean(saved) }
    }
    if (session.stage === 'card' && session.card?.status === 'draft') {
        // An automated member accepts the draft as is; a blank field is marked as still to be confirmed.
        const fields = trimCard(session.card.fields)
        for (const { key } of CARD_FIELDS) if (!fields[key]) fields[key] = NEEDS_CONFIRMATION
        return handled.has('card') ? { kind: 'wait' } : { kind: 'card', key: 'card', fields }
    }
    return { kind: 'wait' }
}
