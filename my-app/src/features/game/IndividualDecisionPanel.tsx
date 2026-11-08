import type { RoomSnapshot } from '../../services/rooms'
import { boardRows, submittedCount, waitingSummary } from './individualDecisionModel'
import type { BoardRow } from './individualDecisionModel'
import { DraftStatus } from './DiscussionDraftPanel'
import type { DiscussionDraftHandle } from './useDiscussionDraft'

/** Connects the control bar's dictation to this panel's text box; null detaches it. */
export type AttachDictation = (sink: ((words: string) => void) | null) => void

/** Board members with their submission status only; other members' texts are never shown. */
export function BoardStatusList({ rows, missingLabel }: { rows: readonly BoardRow[]; missingLabel: string }) {
    return <ul className="decision-board-list" aria-label="Board members">
        {rows.map((row) => <li key={row.member_id} className={row.submitted ? 'is-submitted' : missingLabel === 'Writing…' || missingLabel === 'Deciding…' ? 'is-writing' : 'is-missing'}>
            <span className="decision-board-name">{row.self ? `${row.name} (you)` : row.name}{row.role && <small>{row.role}</small>}</span>
            <span className={`vote-badge ${row.submitted ? 'vote-badge--voted' : 'decision-badge--waiting'}`}>{row.submitted ? 'Submitted' : missingLabel}</span>
        </li>)}
    </ul>
}

/**
 * Round 1 decision status, without a separate text box: the member gives their decision with AI reply (spoken in their
 * role voice, heard only in their own window) or types it in Chat. Shows their recorded decision and who the round is
 * still waiting for, themselves included.
 */
export function DecisionStatusPanel({ room, speaking, caption, saving, draft }: { room: RoomSnapshot; speaking: boolean; caption: string; saving: boolean; draft: DiscussionDraftHandle }) {
    const game = room.game
    if (!game || room.phase !== 'individual_decision') return null
    const recorded = game.individual_decisions?.self ?? null
    const canSubmit = (game.allowed_actions ?? []).includes('submit_decision')
    const rows = boardRows(game.individual_decisions, room.self_member_id)
    const progress = submittedCount(rows)
    const roleName = game.individual_decisions?.submitted.find((row) => row.member_id === room.self_member_id)?.role_name
    return <section className="vote-panel decision-panel" aria-labelledby="decision-status-title">
        <header className="vote-panel-header">
            <div>
                <p className="vote-eyebrow">Round 1</p>
                <h3 id="decision-status-title">Your individual decision{roleName ? ` as ${roleName}` : ''}</h3>
            </div>
        </header>
        {canSubmit ? <p className="vote-note">Give your decision with <strong>AI reply</strong> in the control bar (spoken in your voice; only you hear it) or review and edit your summary in <strong>Your decision</strong> below, then confirm it. Only you see your decision. Decisions close when everyone confirms.</p>
            : !recorded && <p className="vote-note">You are observing this round. Only members taking part in this round give a decision.</p>}
        {canSubmit && <DraftStatus draft={draft} />}
        {(speaking || saving) && caption && <p className="decision-compact"><span className="vote-badge decision-badge--waiting">{saving ? 'Saving…' : 'Speaking'}</span> {saving ? 'Saving your decision…' : 'Speaking your decision; it is saved when it finishes.'}</p>}
        {recorded && !speaking && !saving && <div className="decision-compact">
            <p><span className="vote-badge vote-badge--voted">Submitted</span> Your decision is recorded.{canSubmit ? ' AI reply or Chat replaces it.' : ''}</p>
            {/* Kept out of the way: the full text only on request. */}
            <details className="decision-peek"><summary>View my decision</summary><p className="decision-text">{recorded.text}</p></details>
        </div>}
        {rows.length > 0 && <div className="decision-board">
            <p className="vote-eyebrow">{progress.done} of {progress.total} decisions submitted</p>
            <p className="decision-waiting" role="status">{waitingSummary(rows)}</p>
            <BoardStatusList rows={rows} missingLabel="Deciding…" />
        </div>}
    </section>
}
