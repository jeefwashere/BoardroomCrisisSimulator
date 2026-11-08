// Pure helpers for the Round 3 multiple choice assessment (five questions, four choices, 0 to 20 points each).
// No JSX, no network, so they can be unit tested.
import type { PrivateQuiz, QuizChoice, QuizQuestion, QuizReview, QuizReviewChoice } from '../../services/facilitation.ts'

export const QUIZ_LENGTH = 5
export const QUIZ_QUESTION_MAX = 20
export const QUIZ_MAX = QUIZ_LENGTH * QUIZ_QUESTION_MAX
export const QUESTION_SECONDS = 60
/** The countdown turns urgent at this many seconds left. */
export const URGENT_SECONDS = 10
/** How often the countdown redraws. */
export const COUNTDOWN_TICK_MS = 250

const STATUSES: readonly PrivateQuiz['status'][] = ['generating', 'ready', 'failed']

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
const choiceId = (value: unknown): string | null => typeof value === 'string' && value ? value : null
const timestamp = (value: unknown): string | null => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
const byStep = <T extends { step: number }>(items: T[]): T[] => items.sort((left, right) => left.step - right.step)

function choice(value: unknown): QuizChoice | null {
    if (!record(value)) return null
    const id = choiceId(value.choice_id)
    return id ? { choice_id: id, text: text(value.text) } : null
}

function reviewChoice(value: unknown): QuizReviewChoice | null {
    const base = choice(value)
    if (!base || !record(value)) return null
    return { ...base, points: integer(value.points) ?? 0, rationale: text(value.rationale) }
}

function question(value: unknown, index: number): QuizQuestion | null {
    if (!record(value)) return null
    const choices = Array.isArray(value.choices) ? value.choices.map(choice).filter((item): item is QuizChoice => item !== null) : []
    const chosen = choiceId(value.chosen)
    const timedOut = !chosen && value.timed_out === true
    return {
        step: integer(value.step) ?? index + 1, question: text(value.question), choices, chosen,
        points: chosen ? integer(value.points) : timedOut ? integer(value.points) ?? 0 : null,
        max: integer(value.max) ?? QUIZ_QUESTION_MAX, deadline: timestamp(value.deadline), timed_out: timedOut,
    }
}

function review(value: unknown, index: number): QuizReview | null {
    if (!record(value)) return null
    const choices = Array.isArray(value.choices) ? value.choices.map(reviewChoice).filter((item): item is QuizReviewChoice => item !== null) : []
    const chosen = choiceId(value.chosen)
    return { step: integer(value.step) ?? index + 1, question: text(value.question), chosen, points: integer(value.points), choices, timed_out: !chosen && value.timed_out === true }
}

/** Reads the `quiz` part of a private session payload defensively; anything that is not an object means no quiz (null). */
export function normalizeQuiz(value: unknown): PrivateQuiz | null {
    if (!record(value)) return null
    const questions = byStep(Array.isArray(value.questions) ? value.questions.map(question).filter((item): item is QuizQuestion => item !== null) : [])
    const reviews = Array.isArray(value.review) ? byStep(value.review.map(review).filter((item): item is QuizReview => item !== null)) : null
    const status = STATUSES.includes(value.status as PrivateQuiz['status']) ? value.status as PrivateQuiz['status'] : 'generating'
    return {
        status,
        current: status === 'ready' ? integer(value.current) : null,
        questions,
        total: integer(value.total) ?? questions.reduce((sum, item) => sum + (item.points ?? 0), 0),
        max: integer(value.max) || QUIZ_MAX,
        question_seconds: integer(value.question_seconds) || QUESTION_SECONDS,
        server_time: timestamp(value.server_time),
        review: reviews,
    }
}

/** Closed: answered, or the clock ran out (0 points). */
export const isClosed = (item: Pick<QuizQuestion, 'chosen' | 'timed_out'>): boolean => item.chosen !== null || item.timed_out

/** The question awaiting the member's pick, or null (generating, failed, complete, or not reached yet). */
export function currentQuestion(quiz: PrivateQuiz | null): QuizQuestion | null {
    if (!quiz || quiz.status !== 'ready' || quiz.current === null) return null
    return quiz.questions.find((item) => item.step === quiz.current && !isClosed(item)) ?? null
}

/** The most recently closed question (highest step answered or timed out). */
export function lastClosed(quiz: PrivateQuiz | null): QuizQuestion | null {
    return quiz?.questions.filter(isClosed).at(-1) ?? null
}

export function closedCount(quiz: PrivateQuiz | null): number {
    return quiz?.questions.filter(isClosed).length ?? 0
}

/** Every reached question is closed and none is current: the quiz is finished (or about to be marked complete). */
export function quizFinished(quiz: PrivateQuiz | null): boolean {
    return Boolean(quiz && quiz.status === 'ready' && !currentQuestion(quiz) && quiz.questions.length > 0 && quiz.questions.every(isClosed))
}

/**
 * The question the card shows: the current one as soon as it arrives (the member answers while the examiner reads),
 * else the last closed one with its result. Null means nothing to show yet.
 */
export function focusQuestion(quiz: PrivateQuiz | null): QuizQuestion | null {
    return currentQuestion(quiz) ?? lastClosed(quiz)
}

/**
 * The result line shown above the current question: the previous question's outcome, so it stays visible after the
 * next question has replaced it. Null before the first question closes or when the focused question is itself closed.
 */
export function previousResult(quiz: PrivateQuiz | null): QuizQuestion | null {
    const current = currentQuestion(quiz)
    if (!current) return null
    return quiz?.questions.filter((item) => isClosed(item) && item.step < current.step).at(-1) ?? null
}

/** Whether a pick for this question can be sent now (open, current, not blocked by a request or an expired clock). */
export function canChoose(quiz: PrivateQuiz | null, item: Pick<QuizQuestion, 'step' | 'chosen' | 'timed_out'>, blocked: boolean): boolean {
    return !blocked && currentQuestion(quiz)?.step === item.step && !isClosed(item)
}

/**
 * Milliseconds left on a question, corrected for clock skew: the server's own `deadline - server_time` minus the time
 * elapsed locally since that payload arrived. Never below 0; null when the payload has no usable clock.
 */
export function remainingMs(deadline: string | null, serverTime: string | null, elapsedMs: number): number | null {
    if (!deadline || !serverTime) return null
    const left = Date.parse(deadline) - Date.parse(serverTime) - Math.max(0, elapsedMs)
    return Number.isFinite(left) ? Math.max(0, left) : null
}

/** Whole seconds shown on the countdown (rounded up, so 0 appears only when the time is really up). */
export function secondsLeft(ms: number): number {
    return Math.max(0, Math.ceil(ms / 1000))
}

/** Share of the question's time still left, 0 to 1, for the countdown bar. */
export function countdownFraction(ms: number, totalSeconds: number): number {
    if (totalSeconds <= 0) return 0
    return Math.min(1, Math.max(0, ms / (totalSeconds * 1000)))
}

export type CountdownPhase = 'running' | 'urgent' | 'expired'

export function countdownPhase(ms: number): CountdownPhase {
    if (ms <= 0) return 'expired'
    return secondsLeft(ms) <= URGENT_SECONDS ? 'urgent' : 'running'
}

/** What a screen reader hears: only when the phase changes (urgent, then time up), never on every tick. */
export function countdownAnnouncement(phase: CountdownPhase): string {
    if (phase === 'urgent') return `${URGENT_SECONDS} seconds or less left.`
    if (phase === 'expired') return 'Time is up.'
    return ''
}

/** Accessible label of the countdown itself (read on demand, not announced). */
export function countdownLabel(step: number, ms: number): string {
    const seconds = secondsLeft(ms)
    return `Time left for question ${step}: ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
}

/** Choice letter shown on the button: the server's id ("a" to "d") in upper case, else its position. */
export function choiceLetter(id: string, index: number): string {
    return /^[a-z]$/i.test(id) ? id.toUpperCase() : String.fromCharCode(65 + index)
}

export function questionHeading(step: number): string {
    return `Question ${step} of ${QUIZ_LENGTH}`
}

export function earnedText(item: Pick<QuizQuestion, 'points' | 'max' | 'timed_out'>): string {
    const max = item.max || QUIZ_QUESTION_MAX
    return item.timed_out ? `Time's up: 0 of ${max}` : `You earned ${item.points ?? 0} of ${max}`
}

/** The previous question's outcome, named, for the line above the next question. */
export function previousResultText(item: Pick<QuizQuestion, 'step' | 'points' | 'max' | 'timed_out'>): string {
    const max = item.max || QUIZ_QUESTION_MAX
    return item.timed_out ? `Question ${item.step}: time ran out, 0 of ${max}` : `Question ${item.step}: you earned ${item.points ?? 0} of ${max}`
}

export function totalText(quiz: Pick<PrivateQuiz, 'total' | 'max'>): string {
    return `Total ${quiz.total} of ${quiz.max || QUIZ_MAX}`
}

export function quizScoreText(quiz: Pick<PrivateQuiz, 'total' | 'max'>): string {
    return `Score ${quiz.total} / ${quiz.max || QUIZ_MAX}`
}

export type QuizChip = { step: number; text: string; status: 'waiting' | 'current' | 'scored' }

/** One chip per question (five), with earned points once answered. */
export function quizChips(quiz: PrivateQuiz): QuizChip[] {
    const current = currentQuestion(quiz)?.step ?? null
    return Array.from({ length: Math.max(QUIZ_LENGTH, quiz.questions.length) }, (_, index) => {
        const step = index + 1
        const item = quiz.questions.find((entry) => entry.step === step)
        const max = item?.max || QUIZ_QUESTION_MAX
        if (item && isClosed(item)) return { step, text: `${item.points ?? 0} / ${max}`, status: 'scored' }
        return { step, text: `- / ${max}`, status: step === current ? 'current' : 'waiting' }
    })
}

/** Short progress for one branch during Round 3: "assessment 2/5". */
export function quizStatusText(quiz: PrivateQuiz): string {
    const step = currentQuestion(quiz)?.step ?? closedCount(quiz) + 1
    return `assessment ${Math.min(QUIZ_LENGTH, Math.max(1, step))}/${QUIZ_LENGTH}`
}

export type ReviewChoiceView = {
    choiceId: string
    letter: string
    text: string
    /** Null when the review is not released (only the member's own earned points are known). */
    points: number | null
    rationale: string
    chosen: boolean
    best: boolean
    /** Plain text markers so the pick and the best choice never rely on color alone. */
    tags: string[]
}

export type ReviewQuestionView = {
    step: number; heading: string; question: string; points: number | null; max: number; choices: ReviewChoiceView[]; released: boolean
    timedOut: boolean
}

function reviewHeading(step: number, points: number | null, max: number, timedOut: boolean): string {
    return `Question ${step} · ${points ?? 0} / ${max}${timedOut ? ' · time ran out' : ''}`
}

function tagsFor(chosen: boolean, best: boolean): string[] {
    return [...(chosen ? ['Your answer'] : []), ...(best ? ['Best answer'] : [])]
}

/**
 * Questions for the results view, in step order. With the released review every choice carries its points and
 * rationale and the best one is marked; without it (ended early) only the answered questions and their earned points.
 */
export function reviewQuestions(quiz: PrivateQuiz): ReviewQuestionView[] {
    if (quiz.review?.length) return quiz.review.map((item) => {
        const top = item.choices.reduce((best, entry) => Math.max(best, entry.points), Number.NEGATIVE_INFINITY)
        const earned = item.points ?? item.choices.find((entry) => entry.choice_id === item.chosen)?.points ?? null
        const max = quiz.questions.find((entry) => entry.step === item.step)?.max || QUIZ_QUESTION_MAX
        const timedOut = item.timed_out
        return {
            step: item.step, question: item.question, points: timedOut ? earned ?? 0 : earned, max, released: true, timedOut,
            heading: reviewHeading(item.step, earned, max, timedOut),
            choices: item.choices.map((entry, index) => {
                const chosen = entry.choice_id === item.chosen
                const best = entry.points === top
                return { choiceId: entry.choice_id, letter: choiceLetter(entry.choice_id, index), text: entry.text, points: entry.points, rationale: entry.rationale, chosen, best, tags: tagsFor(chosen, best) }
            }),
        }
    })
    return quiz.questions.filter(isClosed).map((item) => ({
        step: item.step, question: item.question, points: item.points, max: item.max, released: false, timedOut: item.timed_out,
        heading: reviewHeading(item.step, item.points, item.max, item.timed_out),
        choices: item.choices.map((entry, index) => {
            const chosen = entry.choice_id === item.chosen
            return { choiceId: entry.choice_id, letter: choiceLetter(entry.choice_id, index), text: entry.text, points: chosen ? item.points : null, rationale: '', chosen, best: false, tags: tagsFor(chosen, false) }
        }),
    }))
}

/** An automated member's pick: deterministic, spread across positions so bots do not always choose the same letter. */
export function botChoice(item: Pick<QuizQuestion, 'step' | 'choices'>, seed = 0): string | null {
    if (!item.choices.length) return null
    return item.choices[(seed + item.step) % item.choices.length].choice_id
}
