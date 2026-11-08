import type { Assessment, PrivateSession } from '../../services/facilitation'
import type { PrivateProgress } from '../../services/rooms'
import { CARD_FIELDS, allComplete, feedbackHeading, progressText, runningScore, stageChips } from './privateSessionModel'
import { QuizResults } from './PrivateQuiz'
import { answeredCount } from './quizModel'

/** Round 3 result: the total, points per stage and, once released, detailed feedback with quoted evidence. */
export function AssessmentResults({ assessment, heading = 'Round 3 · Assessment complete' }: { assessment: Assessment; heading?: string }) {
    const chips = stageChips(assessment)
    return <section className="private-results" aria-label="Assessment results">
        <p className="private-eyebrow">{heading}</p>
        <p className="private-total"><strong>{runningScore(assessment)}</strong><span>/ {assessment.max || 100}</span></p>
        <ol className="private-chips">
            {chips.map((chip) => <li key={chip.step} className={`private-chip private-chip--${chip.status}`}><span>Stage {chip.step} · {chip.title}</span><strong>{chip.text}</strong></li>)}
        </ol>
        {assessment.feedback?.length ? <div className="private-feedback">
            {assessment.feedback.map((stage) => <article key={stage.step} className="private-feedback-stage">
                <h4>{feedbackHeading(stage, assessment)}</h4>
                <ul>
                    {stage.criteria.map((item) => <li key={item.id || item.label} className="private-criterion">
                        <div className="private-criterion-head"><span>{item.label}</span><strong>{item.points} / {item.max}</strong></div>
                        {item.reason && <p>{item.reason}</p>}
                        {item.quote && <blockquote>“{item.quote}”</blockquote>}
                    </li>)}
                </ul>
            </article>)}
        </div> : <p className="private-note">Detailed feedback appears once all three stages are scored.</p>}
    </section>
}

/** Every board member's private session stage (never their answers). */
export function PrivateBoard({ progress, selfId }: { progress: readonly PrivateProgress[] | null | undefined; selfId: string }) {
    if (!progress?.length) return null
    const done = allComplete(progress)
    return <section className="private-board" aria-label="Board members">
        <p className="private-eyebrow">{done ? 'Every board member has finished' : 'Waiting for the other board members'}</p>
        <ul>
            {progress.map((item) => <li key={item.member_id} className={`private-board-row is-${item.stage}`}>
                <span>{item.member_id === selfId ? `${item.display_name} (you)` : item.display_name}{item.role_name && <small>{item.role_name}</small>}</span>
                <span className="private-board-stage">{progressText(item.stage)}</span>
            </li>)}
        </ul>
    </section>
}

/** Ended view: the confirmed Round 2 response card and the Round 3 result. Round 1 is shown by IndividualDecisionReport. */
export default function PrivateSessionReport({ session, unavailable, notStarted, notEligible = false, retry, sending = false }: {
    session: PrivateSession | null; unavailable: boolean; notStarted: boolean; notEligible?: boolean
    /** Scoring that failed stays retryable after the private sessions end. */
    retry?: () => Promise<boolean>; sending?: boolean
}) {
    if (!session) return unavailable || notEligible ? null : <section className="vote-panel decision-panel private-report"><p className="vote-note">{notStarted ? 'The game ended before your private session began.' : 'Loading your private session record…'}</p></section>
    const card = session.card
    const quiz = session.quiz
    const scored = quiz ? answeredCount(quiz) > 0 : session.assessment.stages.some((stage) => stage.status === 'scored')
    const heading = session.stage === 'complete' ? 'Round 3 · Assessment' : 'Round 3 · Assessment (ended early)'
    return <>
        <section className="vote-panel decision-panel private-report" aria-labelledby="private-card-title">
            <header className="vote-panel-header"><div><p className="vote-eyebrow">Round 2 · Private coaching</p><h3 id="private-card-title">Your response card</h3></div></header>
            {card && card.status === 'confirmed' ? <dl className="private-card-summary">
                {CARD_FIELDS.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{card.fields[key] || '—'}</dd></div>)}
            </dl> : <p className="vote-note">{card ? 'Your response card was not confirmed before the private sessions ended.' : 'Your private coaching did not reach the response card.'}</p>}
        </section>
        <section className="vote-panel decision-panel private-report">
            {scored || session.stage === 'complete'
                ? quiz ? <QuizResults quiz={quiz} heading={heading} /> : <AssessmentResults assessment={session.assessment} heading={heading} />
                : <><p className="vote-eyebrow">Round 3 · Assessment</p><p className="vote-note">{quiz ? 'No assessment question was answered before the private sessions ended.' : 'No assessment stage was scored before the private sessions ended.'}</p></>}
            {session.retryable && retry && <div className="vote-confirm-actions">
                <p className="vote-note">{quiz ? (session.busy ? 'Preparing your assessment questions…' : 'Your assessment questions could not be prepared.') : session.busy ? 'Scoring your answer…' : 'Scoring failed. Your answer is saved.'}</p>
                <button type="button" className="vote-primary" disabled={sending || session.busy} onClick={() => void retry()}>Retry</button>
            </div>}
        </section>
    </>
}
