import { useEffect, useState } from 'react'
import type { RoomSnapshot } from '../../services/rooms'
import Countdown from './Countdown'
import { DECISION_LIMIT, DECISION_PROMPT, boardRows, canSubmitDecision, submittedCount } from './individualDecisionModel'
import type { BoardRow } from './individualDecisionModel'
import { DICTATION_UNAVAILABLE, appendTranscript } from './dictationModel'
import { useDictation } from './useDictation'

type Act = (path: string, fields?: Record<string, unknown>) => Promise<boolean>

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
export default function IndividualDecisionPanel({ room, pending, act, notice }: { room: RoomSnapshot; pending: boolean; act: Act; notice?: string }) {
    const game = room.game
    const recorded = game?.individual_decisions?.self ?? null
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(() => recorded?.text ?? '')
    const [failed, setFailed] = useState(false)
    // Voice or text: dictated final words are appended to whatever is already typed and stay editable.
    const dictation = useDictation((words) => setDraft((current) => appendTranscript(current, words)))
    const { stop: stopDictation } = dictation
    // Unsupported browsers and a refused microphone hide the button and leave a short note instead.
    const voiceNote = dictation.supported ? dictation.note : DICTATION_UNAVAILABLE
    const showMic = dictation.supported && dictation.note !== DICTATION_UNAVAILABLE
    const active = room.phase === 'individual_decision'
    const phaseId = game?.phase_id
    useEffect(() => { if (!active) stopDictation() }, [active, phaseId, stopDictation])
    if (!game || !active) return null

    const canSubmit = (game.allowed_actions ?? []).includes('submit_decision')
    const rows = boardRows(game.individual_decisions, room.self_member_id)
    const progress = submittedCount(rows)
    const showForm = canSubmit && (!recorded || editing)
    const roleName = game.individual_decisions?.submitted.find((row) => row.member_id === room.self_member_id)?.role_name

    async function submit() {
        if (!canSubmitDecision(draft, recorded?.text)) return
        dictation.stop()
        setFailed(false)
        const ok = await act(`rounds/${game!.round_id}/decision`, { text: draft.trim() })
        if (ok) setEditing(false)
        else setFailed(true)
    }

    return <section className="vote-panel decision-panel" aria-labelledby="decision-panel-title">
        <header className="vote-panel-header">
            <div>
                <p className="vote-eyebrow">Round 1</p>
                <h3 id="decision-panel-title">Your individual decision</h3>
            </div>
            <Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} className="vote-countdown" />
        </header>

        {!canSubmit && !recorded && <p className="vote-note">You are observing this round. Only members taking part in this round write a decision.</p>}

        {showForm && <form className="decision-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <label className="decision-field">
                <span className="decision-label">Your decision{roleName ? ` as ${roleName}` : ''}</span>
                <textarea rows={6} maxLength={DECISION_LIMIT} required autoFocus={editing} aria-describedby="decision-help" placeholder={DECISION_PROMPT}
                    value={draft} onChange={(event) => setDraft(event.target.value)} />
                <span className="decision-helper" id="decision-help">{DECISION_PROMPT} Only you see your text.</span>
            </label>
            {(showMic || voiceNote) && <div className="decision-voice">
                {showMic && <button type="button" className={`vote-secondary decision-mic${dictation.listening ? ' is-listening' : ''}`} aria-pressed={dictation.listening}
                    onClick={() => dictation.listening ? dictation.stop() : dictation.start()}>{dictation.listening ? '■ Stop' : '🎙 Speak your decision'}</button>}
                {dictation.listening && <span className="decision-listening" role="status"><span className="vote-waiting-dot" aria-hidden="true" />Listening…</span>}
                {dictation.listening && dictation.interim && <span className="decision-interim" aria-live="polite">{dictation.interim}</span>}
                {voiceNote && <p className="decision-voice-note" role="status">{voiceNote}</p>}
            </div>}
            {failed && <p className="vote-custom-error" role="alert">{notice || 'Your decision could not be saved. Please try again.'}</p>}
            <div className="vote-confirm-actions">
                {recorded && <button type="button" className="vote-secondary" disabled={pending} onClick={() => { dictation.stop(); setEditing(false); setFailed(false); setDraft(recorded.text) }}>Cancel</button>}
                <button type="submit" className="vote-primary" disabled={pending || !canSubmitDecision(draft, recorded?.text)}>{recorded ? 'Save changes' : 'Submit my decision'}</button>
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
            <p className="vote-note">Decisions close when everyone has submitted or the time runs out.</p>
        </div>}
    </section>
}
