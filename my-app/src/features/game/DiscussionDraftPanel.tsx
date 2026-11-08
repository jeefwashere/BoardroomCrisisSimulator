import type { DiscussionDraftHandle } from './useDiscussionDraft'
import { DECISION_LIMIT } from './individualDecisionModel'

export function DraftStatus({ draft }: { draft: DiscussionDraftHandle }) {
    const state = draft.state
    return <>
        <p className="decision-helper" role="status">{state.status === 'pending' ? 'Summarizing your saved contributions…' : state.status === 'empty' ? 'Your sent text and reviewed speaking transcripts will appear here as a summary.' : state.status === 'failed' ? 'Summary unavailable. Your text is kept.' : state.source === 'offline' ? 'Saved contribution summary. AI is unavailable.' : 'AI summary of your own contributions. Review and edit before submitting.'}</p>
        {!state.storageAvailable && <p className="decision-helper">Tab recovery is unavailable in this browser. Keep this page open to retain your draft.</p>}
        {(state.status === 'failed' || state.source === 'offline') && <button type="button" className="vote-secondary" onClick={() => void draft.retry()}>Retry AI summary</button>}
        {state.suggestion?.text && <div className="decision-recorded"><p className="vote-eyebrow">Updated summary suggestion</p><p className="decision-text">{state.suggestion.text}</p><button type="button" className="vote-secondary" onClick={draft.accept}>Use this summary</button><p className="decision-helper">Your edits stay until you choose to replace them.</p></div>}
    </>
}

export default function DiscussionDraftPanel({ draft, closed = false }: { draft: DiscussionDraftHandle; closed?: boolean }) {
    if (closed && (!draft.state.text || draft.state.text.trim() === draft.state.submittedText?.trim())) return null
    return <section className="vote-panel decision-panel"><h3>{closed ? 'Your unsent draft copy' : 'Your answer draft'}</h3>
        {closed ? <><p className="decision-helper">Decisions are closed. This copy was kept in this tab and was not submitted.</p><p className="decision-text">{draft.state.text}</p></> : <>
            <label className="decision-field"><span className="decision-label">Personal summary</span><textarea rows={5} maxLength={DECISION_LIMIT} value={draft.state.text} onChange={(event) => draft.edit(event.target.value)} placeholder="Your summary will appear after you speak or send text." /></label>
            <DraftStatus draft={draft} />
            <p className="decision-helper">Only you see this draft. You will confirm your answer after discussion.</p>
        </>}
    </section>
}
