import { useEffect, useState } from 'react'
import type { RoomSnapshot } from '../../services/rooms'
import { DECISION_LIMIT, DECISION_PROMPT, boardRows, canSubmitDecision, submittedCount } from './individualDecisionModel'
import type { BoardRow } from './individualDecisionModel'
import { DraftStatus } from './DiscussionDraftPanel'
import type { DiscussionDraftHandle } from './useDiscussionDraft'
import type { useDictation } from './useDictation'

type Act = (path: string, fields?: Record<string, unknown>) => Promise<boolean>
type Dictation = ReturnType<typeof useDictation>
/** Connects the control bar's dictation to this panel's text box; null detaches it. */
export type AttachDictation = (sink: ((words: string) => void) | null) => void

/** Board members with their submission status only; other members' texts are never shown. */
export function BoardStatusList({ rows, missingLabel }: { rows: readonly BoardRow[]; missingLabel: string }) {
    return <ul className="decision-board-list" aria-label="Board members">
        {rows.map((row) => <li key={row.member_id} className={row.submitted ? 'is-submitted' : missingLabel === 'Writing…' ? 'is-writing' : 'is-missing'}>
            <span className="decision-board-name">{row.self ? `${row.name} (you)` : row.name}{row.role && <small>{row.role}</small>}</span>
            <span className={`vote-badge ${row.submitted ? 'vote-badge--voted' : 'decision-badge--waiting'}`}>{row.submitted ? 'Submitted' : missingLabel}</span>
        </li>)}
    </ul>
}

/** Round 1 individual decision: replaces the board vote when `game.decision_mode === 'individual'`. */
export default function IndividualDecisionPanel({ room, pending, act, notice, dictation, attachDictation, answerDraft }: { room: RoomSnapshot; pending: boolean; act: Act; notice?: string; dictation: Dictation; attachDictation: AttachDictation; answerDraft: DiscussionDraftHandle }) {
    const game = room.game
    const recorded = game?.individual_decisions?.self ?? null
    const [editing, setEditing] = useState(false)
    const draft = answerDraft.state.text
    const setDraft = answerDraft.edit
    const append = answerDraft.append
    const [failed, setFailed] = useState(false)
    const active = room.phase === 'individual_decision'
    const canSubmit = (game?.allowed_actions ?? []).includes('submit_decision')
    const showForm = Boolean(game) && active && canSubmit && (!recorded || editing)
    // Voice or text: the control bar's Dictate button appends final words to whatever is already typed; they stay editable.
    useEffect(() => {
        if (!showForm) return
        attachDictation(append)
        return () => attachDictation(null)
    }, [showForm, attachDictation, append])
    if (!game || !active) return null

    const rows = boardRows(game.individual_decisions, room.self_member_id)
    const progress = submittedCount(rows)
    const roleName = game.individual_decisions?.submitted.find((row) => row.member_id === room.self_member_id)?.role_name

    async function submit() {
        if (!canSubmitDecision(draft, recorded?.text)) return
        dictation.stop()
        // Confirmation transfers this text to human ownership even if saving later fails.
        answerDraft.edit(draft)
        setFailed(false)
        const ok = await act(`rounds/${game!.round_id}/decision`, { text: draft.trim() })
        if (ok) { answerDraft.submitted(draft.trim()); setEditing(false) }
        else setFailed(true)
    }

    return <section className="vote-panel decision-panel" aria-labelledby="decision-panel-title">
        <header className="vote-panel-header">
            <div>
                <p className="vote-eyebrow">Round 1</p>
                <h3 id="decision-panel-title">Your individual decision</h3>
            </div>
        </header>

        {!canSubmit && !recorded && <p className="vote-note">You are observing this round. Only members taking part in this round write a decision.</p>}

        {showForm && <form className="decision-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <label className="decision-field">
                <span className="decision-label">Your decision{roleName ? ` as ${roleName}` : ''}</span>
                <textarea rows={6} maxLength={DECISION_LIMIT} required autoFocus={editing} aria-describedby="decision-help" placeholder={DECISION_PROMPT}
                    value={draft} onChange={(event) => setDraft(event.target.value)} />
                <span className="decision-helper" id="decision-help">Only you see your text. Review the summary, edit it, then confirm. Decisions close when everyone confirms.</span>
            </label>
            <DraftStatus draft={answerDraft} />
            {(dictation.listening || dictation.note) && <div className="decision-voice">
                {dictation.listening && <span className="decision-listening" role="status"><span className="vote-waiting-dot" aria-hidden="true" />Listening…</span>}
                {dictation.listening && dictation.interim && <span className="decision-interim" aria-live="polite">{dictation.interim}</span>}
                {dictation.note && <p className="decision-voice-note" role="status">{dictation.note}</p>}
            </div>}
            {failed && <p className="vote-custom-error" role="alert">{notice || 'Your decision could not be saved. Please try again.'}</p>}
            <div className="vote-confirm-actions">
                {recorded && <button type="button" className="vote-secondary" disabled={pending} onClick={() => { dictation.stop(); setEditing(false); setFailed(false); setDraft(recorded.text) }}>Cancel</button>}
                <button type="submit" className="vote-primary" disabled={pending || !canSubmitDecision(draft, recorded?.text)}>{recorded ? 'Save changes' : 'Confirm my decision'}</button>
            </div>
        </form>}

        {recorded && !editing && <div className="decision-recorded">
            <div className="vote-confirmed">
                <p><span className="vote-badge vote-badge--voted">Submitted</span> Your decision is recorded. You can edit it until decisions close.</p>
                {canSubmit && <button type="button" className="vote-secondary" disabled={pending} onClick={() => { setDraft(recorded.text); setFailed(false); setEditing(true) }}>Edit</button>}
            </div>
            <p className="decision-text">{recorded.text}</p>
        </div>}

        {rows.length > 0 && <div className="decision-board">
            <p className="vote-eyebrow">{progress.done} of {progress.total} decisions submitted</p>
            <BoardStatusList rows={rows} missingLabel="Writing…" />
        </div>}
    </section>
}
