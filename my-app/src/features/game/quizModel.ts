// Pure helpers for the Round 3 multiple choice assessment (five questions, four choices, 0 to 20 points each).
// No JSX, no network, so they can be unit tested.
import type { PrivateQuiz, QuizChoice, QuizQuestion, QuizReview, QuizReviewChoice } from '../../services/facilitation.ts'

export const QUIZ_LENGTH = 5
export const QUIZ_QUESTION_MAX = 20
export const QUIZ_MAX = QUIZ_LENGTH * QUIZ_QUESTION_MAX

const STATUSES: readonly PrivateQuiz['status'][] = ['generating', 'ready', 'failed']

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
const choiceId = (value: unknown): string | null => typeof value === 'string' && value ? value : null
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
    return { step: integer(value.step) ?? index + 1, question: text(value.question), choices, chosen, points: chosen ? integer(value.points) : null, max: integer(value.max) ?? QUIZ_QUESTION_MAX }
}

function review(value: unknown, index: number): QuizReview | null {
    if (!record(value)) return null
    const choices = Array.isArray(value.choices) ? value.choices.map(reviewChoice).filter((item): item is QuizReviewChoice => item !== null) : []
    return { step: integer(value.step) ?? index + 1, question: text(value.question), chosen: choiceId(value.chosen), points: integer(value.points), choices }
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
        review: reviews,
    }
}

export const isAnswered = (item: Pick<QuizQuestion, 'chosen'>): boolean => item.chosen !== null

/** The question awaiting the member's pick, or null (generating, failed, complete, or not reached yet). */
export function currentQuestion(quiz: PrivateQuiz | null): QuizQuestion | null {
    if (!quiz || quiz.status !== 'ready' || quiz.current === null) return null
    return quiz.questions.find((item) => item.step === quiz.current && !isAnswered(item)) ?? null
}

/** The most recently answered question (highest step with a pick). */
export function lastAnswered(quiz: PrivateQuiz | null): QuizQuestion | null {
    return quiz?.questions.filter(isAnswered).at(-1) ?? null
}

export function answeredCount(quiz: PrivateQuiz | null): number {
    return quiz?.questions.filter(isAnswered).length ?? 0
}

/**
 * The question the card shows. While the examiner is still speaking (not caught up) the card keeps the last answered
 * question and its result on screen; once caught up it moves to the current question. Null means nothing to show yet.
 */
export function focusQuestion(quiz: PrivateQuiz | null, caughtUp: boolean): QuizQuestion | null {
    if (!quiz) return null
    return (caughtUp ? currentQuestion(quiz) : null) ?? lastAnswered(quiz)
}

/** Whether a pick for this question can be sent now. */
export function canChoose(quiz: PrivateQuiz | null, item: Pick<QuizQuestion, 'step' | 'chosen'>, blocked: boolean): boolean {
    return !blocked && currentQuestion(quiz)?.step === item.step && !isAnswered(item)
}

/** Choice letter shown on the button: the server's id ("a" to "d") in upper case, else its position. */
export function choiceLetter(id: string, index: number): string {
    return /^[a-z]$/i.test(id) ? id.toUpperCase() : String.fromCharCode(65 + index)
}

export function questionHeading(step: number): string {
    return `Question ${step} of ${QUIZ_LENGTH}`
}

export function earnedText(item: Pick<QuizQuestion, 'points' | 'max'>): string {
    return `You earned ${item.points ?? 0} of ${item.max || QUIZ_QUESTION_MAX}`
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
        if (item && isAnswered(item)) return { step, text: `${item.points ?? 0} / ${max}`, status: 'scored' }
        return { step, text: `- / ${max}`, status: step === current ? 'current' : 'waiting' }
    })
}

/** Short progress for one branch during Round 3: "assessment 2/5". */
export function quizStatusText(quiz: PrivateQuiz): string {
    const step = currentQuestion(quiz)?.step ?? answeredCount(quiz) + 1
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

export type ReviewQuestionView = { step: number; heading: string; question: string; points: number | null; max: number; choices: ReviewChoiceView[]; released: boolean }

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
        return {
            step: item.step, question: item.question, points: earned, max, released: true,
            heading: `Question ${item.step} · ${earned ?? 0} / ${max}`,
            choices: item.choices.map((entry, index) => {
                const chosen = entry.choice_id === item.chosen
                const best = entry.points === top
                return { choiceId: entry.choice_id, letter: choiceLetter(entry.choice_id, index), text: entry.text, points: entry.points, rationale: entry.rationale, chosen, best, tags: tagsFor(chosen, best) }
            }),
        }
    })
    return quiz.questions.filter(isAnswered).map((item) => ({
        step: item.step, question: item.question, points: item.points, max: item.max, released: false,
        heading: `Question ${item.step} · ${item.points ?? 0} / ${item.max}`,
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
