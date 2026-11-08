import { useEffect, useId, useRef, useState } from 'react'
import type { PrivateQuiz, QuizQuestion } from '../../services/facilitation'
import {
    COUNTDOWN_TICK_MS, canChoose, choiceLetter, countdownAnnouncement, countdownFraction, countdownLabel, countdownPhase, earnedText, focusQuestion,
    isClosed, outcomeTag, previousResult, previousResultText, questionHeading, quizOutcome, remainingMs, reviewQuestions, secondsLeft, totalText,
} from './quizModel'
import { playQuizSound, preloadQuizSounds } from './quizSounds'
import { emitFaceReaction } from '../boardroom3d/faceExpressions'

/** How long an answered question stays on screen, coloured by its result, before the next one shows. */
const REVEAL_MS = 1800

/** Milliseconds since `key` last changed, redrawn every tick; 0 right after a change (a fresh payload resets the clock). */
function useElapsed(key: string, active: boolean): number {
    const [tick, setTick] = useState({ key, elapsed: 0 })
    useEffect(() => {
        if (!active) return
        const started = performance.now()
        const timer = setInterval(() => setTick({ key, elapsed: performance.now() - started }), COUNTDOWN_TICK_MS)
        return () => clearInterval(timer)
    }, [key, active])
    return tick.key === key ? tick.elapsed : 0
}

/** Seconds left with a bar; urgent under ten seconds. Screen readers hear only the urgent and time up moments. */
function QuizCountdown({ step, ms, totalSeconds }: { step: number; ms: number; totalSeconds: number }) {
    const phase = countdownPhase(ms)
    const seconds = secondsLeft(ms)
    return <div className={`private-quiz-timer is-${phase}`}>
        <div className="private-quiz-timer-head">
            <span role="timer" aria-label={countdownLabel(step, ms)}><strong aria-hidden="true">{seconds}</strong><span aria-hidden="true"> s left</span></span>
        </div>
        <div className="private-quiz-timer-track" aria-hidden="true"><span style={{ transform: `scaleX(${countdownFraction(ms, totalSeconds)})` }} /></div>
        <span className="game-visually-hidden" role="status">{countdownAnnouncement(phase)}</span>
    </div>
}

/** One question with its four choices as big buttons. The pick is final; once closed the card shows the earned points. */
function QuizCard({ quiz, question, blocked, onChoose }: {
    quiz: PrivateQuiz; question: QuizQuestion; blocked: boolean; onChoose: (step: number, choiceId: string) => Promise<boolean>
}) {
    const headingId = useId()
    const [pending, setPending] = useState<string | null>(null)
    const closed = isClosed(question)
    const live = !closed && question.deadline !== null
    const elapsed = useElapsed(`${quiz.server_time}|${question.deadline}`, live)
    const ms = live ? remainingMs(question.deadline, quiz.server_time, elapsed) : null
    const expired = ms === 0
    const open = canChoose(quiz, question, blocked || pending !== null || expired)
    const previous = previousResult(quiz)
    const outcome = closed ? quizOutcome(question) : null

    // The ticker: one tick per second while the question is open, quiet at first and louder in the last ten seconds.
    const seconds = ms === null ? null : secondsLeft(ms)
    const ticking = useRef(false)
    useEffect(() => { ticking.current = open }, [open])
    useEffect(() => {
        if (seconds === null || seconds <= 0 || !ticking.current) return
        playQuizSound('tick', seconds <= 10 ? 0.85 : 0.3)
    }, [seconds])

    async function pick(choiceId: string) {
        if (!open) return
        setPending(choiceId)
        try { await onChoose(question.step, choiceId) } finally { setPending(null) }
    }

    return <section className="private-quiz" aria-labelledby={headingId}>
        <header className="private-quiz-head">
            <p className="private-eyebrow">Round 3 · {questionHeading(question.step)}</p>
            {ms !== null && <QuizCountdown step={question.step} ms={ms} totalSeconds={quiz.question_seconds} />}
        </header>
        {previous && !closed && <p className="private-quiz-previous">{previousResultText(previous)} · {totalText(quiz)}</p>}
        <h3 id={headingId} className="private-question private-quiz-question" tabIndex={-1}>{question.question}</h3>
        <div className="private-quiz-choices" role="group" aria-labelledby={headingId} aria-busy={pending !== null}>
            {question.choices.map((choice, index) => {
                const chosen = choice.choice_id === question.chosen
                const sending = choice.choice_id === pending
                return <button key={choice.choice_id} type="button" disabled={!open}
                    className={`private-quiz-choice${chosen ? ' is-chosen' : ''}${chosen && outcome ? ` is-${outcome}` : ''}${sending ? ' is-sending' : ''}`}
                    onClick={() => void pick(choice.choice_id)}>
                    <span className="private-quiz-letter">{choiceLetter(choice.choice_id, index)}</span>
                    <span className="private-quiz-text">{choice.text}</span>
                    {chosen && <span className="private-quiz-tag">{outcomeTag(outcome, question.points)}</span>}
                    {sending && <span className="private-quiz-tag">Sending…</span>}
                </button>
            })}
        </div>
        <div className="private-quiz-foot" role="status">
            {closed
                ? <p className={`private-quiz-result${question.timed_out ? ' is-timed-out' : ''}${outcome ? ` is-${outcome}` : ''}`}><strong>{earnedText(question)}</strong><span>{totalText(quiz)}</span></p>
                : expired ? <p className="private-hint">Time is up. The examiner is closing this question…</p>
                : <p className="private-hint">Choose one answer. Your choice is final.</p>}
        </div>
    </section>
}

/**
 * Round 3 on the main stage: a calm loading state while the examiner writes the questions, a retry when that failed,
 * then one question card at a time, shown as soon as it arrives (the clock runs while the examiner reads it).
 */
export function QuizStage({ quiz, blocked, agentName, retryable, onChoose, onRetry }: {
    quiz: PrivateQuiz; blocked: boolean; agentName: string; retryable: boolean
    onChoose: (step: number, choiceId: string) => Promise<boolean>; onRetry: () => Promise<boolean>
}) {
    const wrapper = useRef<HTMLDivElement>(null)
    // Keyboard users who were in the card follow it to the next question.
    const inside = useRef(false)
    const focus = focusQuestion(quiz)

    // When a question closes (a pick or a timeout), play its result sound, show your character's reaction in 3D and keep
    // it on screen briefly, coloured red, amber or green, before the next question. Questions already closed when the
    // stage mounts stay silent.
    const seen = useRef<Set<number> | null>(null)
    const [reveal, setReveal] = useState<number | null>(null)
    useEffect(() => { preloadQuizSounds() }, [])
    useEffect(() => {
        const closed = quiz.questions.filter(isClosed)
        if (seen.current === null) { seen.current = new Set(closed.map((item) => item.step)); return }
        const known = seen.current
        const fresh = closed.filter((item) => !known.has(item.step))
        if (!fresh.length) return
        fresh.forEach((item) => known.add(item.step))
        const latest = fresh[fresh.length - 1]
        const outcome = quizOutcome(latest)
        if (outcome) {
            playQuizSound(outcome)
            // In the 3D boardroom your own character frowns at a wrong answer and smiles at the best one.
            emitFaceReaction(outcome)
        }
        setReveal(latest.step)
    }, [quiz.questions])
    useEffect(() => {
        if (reveal === null) return
        const timer = setTimeout(() => setReveal(null), REVEAL_MS)
        return () => clearTimeout(timer)
    }, [reveal])
    const shown = (reveal !== null && quiz.questions.find((item) => item.step === reveal)) || focus
    const step = focus && !isClosed(focus) ? focus.step : null
    useEffect(() => {
        if (step !== null && inside.current) wrapper.current?.querySelector<HTMLElement>('.private-quiz-question')?.focus()
    }, [step])

    if (quiz.status === 'generating') return <div className="private-quiz-stage">
        <div className="private-quiz opening-shimmer private-quiz-loading" aria-busy="true">
            <p className="private-eyebrow">Round 3 · Assessment</p>
            <p className="opening-shimmer-label" role="status">{agentName} is writing your five multiple choice questions…</p>
            <span /><span /><span />
        </div>
    </div>
    if (quiz.status === 'failed') return <div className="private-quiz-stage">
        <div className="private-quiz private-retry" role="alert">
            <p className="private-eyebrow">Round 3 · Assessment</p>
            <p>{agentName} could not prepare your assessment questions. Your earlier answers are kept.</p>
            {retryable && <button type="button" className="opening-play" disabled={blocked} onClick={() => void onRetry()}>Retry</button>}
        </div>
    </div>
    return <div ref={wrapper} className="private-quiz-stage" onFocus={() => { inside.current = true }}
        onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) inside.current = false }}>
        {shown
            ? <QuizCard key={shown.step} quiz={quiz} question={shown} blocked={blocked} onChoose={onChoose} />
            : <div className="private-quiz"><p className="private-note" role="status">The first question is on its way…</p></div>}
    </div>
}

/** Round 3 result: the total and, once released, every choice's points and rationale with the pick and the best choice marked. */
export function QuizResults({ quiz, heading = 'Round 3 · Assessment complete' }: { quiz: PrivateQuiz; heading?: string }) {
    const questions = reviewQuestions(quiz)
    const released = questions.some((item) => item.released)
    return <section className="private-results" aria-label="Assessment results">
        <p className="private-eyebrow">{heading}</p>
        <p className="private-total"><strong>{quiz.total}</strong><span>/ {quiz.max}</span></p>
        {questions.length ? <div className="private-feedback">
            {questions.map((item) => <article key={item.step} className="private-feedback-stage private-review">
                <h4>{item.heading}</h4>
                <p className="private-review-question">{item.question}</p>
                {item.timedOut && <p className="private-note">Time ran out before you chose, so this question earned 0 points.</p>}
                <ul>
                    {item.choices.map((choice) => <li key={choice.choiceId} className={`private-criterion private-review-choice${choice.chosen ? ' is-chosen' : ''}${choice.best ? ' is-best' : ''}`}>
                        <div className="private-criterion-head">
                            <span>{choice.letter}. {choice.text}</span>
                            {choice.points !== null && <strong>{choice.points} / {item.max}</strong>}
                        </div>
                        {choice.tags.length > 0 && <p className="private-review-tags">{choice.tags.map((tag) => <span key={tag} className={`private-quiz-tag${tag === 'Best answer' ? ' is-best' : ''}`}>{tag}</span>)}</p>}
                        {choice.rationale && <p>{choice.rationale}</p>}
                    </li>)}
                </ul>
            </article>)}
        </div> : <p className="private-note">No question was answered.</p>}
        {!released && questions.length > 0 && <p className="private-note">The full review, with every choice's points and reasoning, appears once the assessment is complete.</p>}
    </section>
}
