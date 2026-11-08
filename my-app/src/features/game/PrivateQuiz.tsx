import { useEffect, useId, useRef, useState } from 'react'
import type { PrivateQuiz, QuizQuestion } from '../../services/facilitation'
import { canChoose, choiceLetter, earnedText, focusQuestion, isAnswered, questionHeading, reviewQuestions, totalText } from './quizModel'

/** One question with its four choices as buttons. The pick is final; once answered the card shows the earned points. */
function QuizCard({ quiz, question, blocked, onChoose }: {
    quiz: PrivateQuiz; question: QuizQuestion; blocked: boolean; onChoose: (step: number, choiceId: string) => Promise<boolean>
}) {
    const headingId = useId()
    const [pending, setPending] = useState<string | null>(null)
    const answered = isAnswered(question)
    const open = canChoose(quiz, question, blocked || pending !== null)

    async function pick(choiceId: string) {
        if (!open) return
        setPending(choiceId)
        try { await onChoose(question.step, choiceId) } finally { setPending(null) }
    }

    return <section className="private-quiz" aria-labelledby={headingId}>
        <header className="private-quiz-head">
            <p className="private-eyebrow">Round 3 · {questionHeading(question.step)}</p>
            <h3 id={headingId} className="private-question" tabIndex={-1}>{question.question}</h3>
        </header>
        <div className="private-quiz-choices" role="group" aria-labelledby={headingId} aria-busy={pending !== null}>
            {question.choices.map((choice, index) => {
                const chosen = choice.choice_id === question.chosen
                const sending = choice.choice_id === pending
                return <button key={choice.choice_id} type="button" disabled={!open}
                    className={`private-quiz-choice${chosen ? ' is-chosen' : ''}${sending ? ' is-sending' : ''}`}
                    onClick={() => void pick(choice.choice_id)}>
                    <span className="private-quiz-letter">{choiceLetter(choice.choice_id, index)}</span>
                    <span className="private-quiz-text">{choice.text}</span>
                    {chosen && <span className="private-quiz-tag">Your answer</span>}
                    {sending && <span className="private-quiz-tag">Sending…</span>}
                </button>
            })}
        </div>
        <div className="private-quiz-foot" role="status">
            {answered
                ? <p className="private-quiz-result"><strong>{earnedText(question)}</strong><span>{totalText(quiz)}</span></p>
                : <p className="private-hint">Choose one answer. Your choice is final.</p>}
        </div>
    </section>
}

/**
 * Round 3 in the answer dock: a calm loading state while the examiner writes the questions, then one question card at
 * a time. The card follows the examiner: it keeps the last result on screen while the next question is being read.
 */
export function QuizPanel({ quiz, caughtUp, blocked, agentName, onChoose }: {
    quiz: PrivateQuiz; caughtUp: boolean; blocked: boolean; agentName: string; onChoose: (step: number, choiceId: string) => Promise<boolean>
}) {
    const wrapper = useRef<HTMLDivElement>(null)
    // Keyboard users who were in the card follow it to the next question.
    const inside = useRef(false)
    const focus = focusQuestion(quiz, caughtUp)
    const step = focus && !isAnswered(focus) ? focus.step : null
    useEffect(() => {
        if (step !== null && inside.current) wrapper.current?.querySelector<HTMLElement>('.private-question')?.focus()
    }, [step])

    if (quiz.status === 'generating') return <div className="opening-shimmer private-card-recording" aria-busy="true">
        <p className="opening-shimmer-label" role="status">{agentName} is writing your five assessment questions…</p><span /><span />
    </div>
    if (quiz.status === 'failed') return null
    return <div ref={wrapper} className="private-quiz-wrap" onFocus={() => { inside.current = true }}
        onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) inside.current = false }}>
        {focus
            ? <QuizCard key={focus.step} quiz={quiz} question={focus} blocked={blocked} onChoose={onChoose} />
            : <p className="private-note">The choices appear when {agentName} finishes reading the question.</p>}
        {focus && isAnswered(focus) && !caughtUp && <p className="private-note">The next question follows when {agentName} finishes speaking.</p>}
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
