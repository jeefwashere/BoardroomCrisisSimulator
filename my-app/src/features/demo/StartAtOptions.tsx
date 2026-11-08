import type { StartAt } from '../../services/rooms'

/** Start point choice for the demo setups: the full game, or the Round 3 test shortcut. */
export default function StartAtOptions({ value, onChange, disabled = false }: { value: StartAt; onChange: (next: StartAt) => void; disabled?: boolean }) {
    return <fieldset className="demo-options" disabled={disabled}>
        <legend>Start at</legend>
        <label><input type="radio" name="start-at" value="beginning" checked={value === 'beginning'} onChange={() => onChange('beginning')} /> The beginning <span>(briefing, Round 1 decisions, Round 2 coaching, then the assessment)</span></label>
        <label><input type="radio" name="start-at" value="assessment" checked={value === 'assessment'} onChange={() => onChange('assessment')} /> Start at Round 3 (prerecorded answers for Rounds 1 and 2) <span>Skips straight to the multiple choice assessment; each player's earlier decision and coaching answers come from the saved recordings.</span></label>
    </fieldset>
}
