import type { IndividualDecisions } from '../../services/rooms'
import { BoardStatusList } from './IndividualDecisionPanel'
import { boardRows, endingTitle, submittedCount } from './individualDecisionModel'

/** Ended view for individual decision games: the caller's own decision and who submitted one. */
export default function IndividualDecisionReport({ decisions, ownText, selfId, endingLabel }: {
    decisions: IndividualDecisions | null | undefined
    /** The caller's decision; falls back to the last one seen during the game when the ended projection omits it. */
    ownText: string | null
    selfId: string
    endingLabel: string | null
}) {
    const rows = boardRows(decisions, selfId)
    const progress = submittedCount(rows)
    return <section className="vote-panel decision-panel decision-report" aria-labelledby="decision-report-title">
        <header className="vote-panel-header">
            <div>
                <p className="vote-eyebrow">Round 1 · Board discussion</p>
                <h3 id="decision-report-title">{endingTitle(endingLabel)}</h3>
            </div>
        </header>
        <div className="decision-report-block">
            <h4>Your decision</h4>
            {ownText ? <p className="decision-text">{ownText}</p> : <p className="vote-note">You did not submit a decision this round.</p>}
        </div>
        {rows.length > 0 && <div className="decision-board">
            <p className="vote-eyebrow">{progress.done} of {progress.total} board members submitted</p>
            <BoardStatusList rows={rows} missingLabel="No decision" />
        </div>}
    </section>
}
