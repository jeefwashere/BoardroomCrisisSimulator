import { useState } from 'react'
import { motion } from 'motion/react'
import type { RoomSnapshot } from '../../services/rooms'
import DecisionGuideButton from './DecisionGuideButton'
import { voteCountSummary } from './votePresentation'
import {
    aiOptionsNotice, ballotProgress, customOptionBadge, mergeLabels, optionDescription, ownCustomOption, proposalDraft,
    resolutionNotice, tallyRows,
} from './votingModel'
import type { ChoiceOption } from './votingModel'

const RESULT_PHASES = ['resolving', 'resolution_failed', 'decision', 'result']

type Act = (path: string, fields?: Record<string, unknown>) => Promise<boolean>

const PROPOSAL_LIMIT = 500

/** "Propose your own option" card at the end of the ballot, or edit/withdraw controls for the caller's own option. */
function CustomOptionCard({ own, initialText, pending, notice, submit }: { own: ChoiceOption | null; initialText: string; pending: boolean; notice?: string; submit: (text: string) => Promise<boolean> }) {
    const [open, setOpen] = useState(false)
    const [text, setText] = useState('')
    const [failed, setFailed] = useState(false)
    async function send(value: string) {
        setFailed(false)
        const ok = await submit(value)
        if (ok) { setOpen(false); setText('') } else setFailed(true)
    }
    const error = failed ? <p className="vote-custom-error" role="alert">{notice || 'The ballot could not be updated. Please try again.'}</p> : null
    if (!open) {
        if (own) return <div className="vote-custom vote-custom--own">
            <div className="vote-custom-row">
                <span className="vote-custom-title">Your custom option</span>
                <span className="vote-confirm-actions">
                    <button type="button" className="vote-secondary" disabled={pending} onClick={() => { setText(initialText); setFailed(false); setOpen(true) }}>Edit</button>
                    <button type="button" className="vote-secondary" disabled={pending} onClick={() => { if (window.confirm('Withdraw your custom option from the ballot?')) void send('') }}>Withdraw</button>
                </span>
            </div>
            <p className="vote-custom-hint">Editing or withdrawing is blocked once your option has votes.</p>
            {error}
        </div>
        return <button type="button" className="vote-custom vote-custom--add" disabled={pending} onClick={() => { setFailed(false); setOpen(true) }}>
            <span className="vote-custom-plus" aria-hidden="true">+</span>
            <span className="vote-choice-body">
                <span className="vote-choice-label">Propose your own option</span>
                <span className="vote-choice-description">Add a response the board can vote for. An AI maps it to an outcome if it wins.</span>
            </span>
        </button>
    }
    return <form className="vote-custom vote-custom--form" onSubmit={(event) => { event.preventDefault(); if (text.trim()) void send(text.trim()) }}>
        <label className="vote-custom-title" htmlFor="vote-custom-text">{own ? 'Edit your custom option' : 'Propose your own option'}</label>
        <textarea id="vote-custom-text" rows={3} maxLength={PROPOSAL_LIMIT} required autoFocus value={text} placeholder="Describe the action the board should take" onChange={(event) => setText(event.target.value)} />
        {error}
        <span className="vote-confirm-actions">
            <button type="button" className="vote-secondary" disabled={pending} onClick={() => { setOpen(false); setFailed(false) }}>Cancel</button>
            <button type="submit" className="vote-primary" disabled={pending || !text.trim()}>{own ? 'Save changes' : 'Add to the ballot'}</button>
        </span>
    </form>
}

export default function VotingPanel({ room, pending, act, notice }: { room: RoomSnapshot; pending: boolean; act: Act; notice?: string }) {
    const game = room.game
    const [labels, setLabels] = useState<Record<string, string>>({})
    const [draft, setDraft] = useState<{ phaseId: string; optionId: string } | null>(null)
    const [changingPhase, setChangingPhase] = useState<string | null>(null)
    const options = (game?.current_node?.options ?? []) as ChoiceOption[]
    // Remember labels for this round so tally bars stay readable after current_node clears.
    const merged = mergeLabels(labels, options)
    if (merged) setLabels(merged)
    if (!game) return null

    const phase = room.phase
    const actions = game.allowed_actions ?? []
    const isVoting = phase === 'voting'
    const isTie = phase === 'tie_break'
    const isResult = RESULT_PHASES.includes(phase)
    const aiNotice = aiOptionsNotice(game, phase)
    if (!isVoting && !isTie && !isResult) {
        return aiNotice ? <p className={`vote-ai-notice${game.ai_options_status === 'pending' ? ' is-pending' : ''}`} role="status">{aiNotice}</p> : null
    }

    const known = { ...labels, ...(merged ?? {}) }
    const canVote = isVoting && actions.includes('vote')
    const canBreakTie = isTie && actions.includes('tie_decision')
    const selfVote = game.self_vote ?? null
    const changing = changingPhase === game.phase_id
    const tied = game.tied_option_ids ?? []
    const choices = isTie ? options.filter((option) => tied.includes(option.option_id)) : options
    const showChoices = (canVote && (!selfVote || changing)) || canBreakTie
    const draftId = draft?.phaseId === game.phase_id && choices.some((option) => option.option_id === draft.optionId) ? draft.optionId : null
    const self = room.members.find((member) => member.member_id === room.self_member_id)
    const memberName = (memberId: string) => room.members.find((member) => member.member_id === memberId)?.display_name
    const eligible = game.eligible_member_ids.length
    const progress = isVoting ? null : ballotProgress(game.vote_counts, eligible)
    const rows = tallyRows(game.vote_counts, known)
    const winner = isResult && game.last_result?.round_number === game.round_number ? game.last_result : null
    const rounds = `rounds/${game.round_id}/`
    const own = ownCustomOption(options, room.self_member_id)
    const proposalCard = isVoting && actions.includes('proposal')
        ? <CustomOptionCard key={own?.option_id ?? 'new'} own={own} initialText={proposalDraft(own, game.proposals)} pending={pending} notice={notice} submit={(text) => act(rounds + 'proposal', { text })} />
        : null
    const resolution = resolutionNotice(game.resolution, phase)

    async function confirm() {
        if (!draftId) return
        const ok = await act(rounds + (isTie ? 'tie-decision' : 'vote'), { option_id: draftId })
        if (ok) { setDraft(null); setChangingPhase(null) }
    }

    const title = isTie ? (canBreakTie ? 'CEO tie decision' : 'Tie on the leading options') : isVoting ? 'Board vote' : 'Decision result'
    return <section className="vote-panel" aria-labelledby="vote-panel-title">
        <header className="vote-panel-header">
            <div>
                <p className="vote-eyebrow">Round {game.round_number} decision</p>
                <h3 id="vote-panel-title">{title}</h3>
                {aiNotice && <p className="vote-ai-notice" role="status">{aiNotice}</p>}
                {isVoting && game.options_source !== 'ai' && <DecisionGuideButton />}
            </div>
        </header>

        {canVote && !selfVote && <p className="vote-decide" role="status"><span className="vote-badge vote-badge--decide">Decide now</span><span>{self?.display_name ?? 'You'}, choose a response, then confirm it before the deadline.</span></p>}
        {isVoting && !canVote && <p className="vote-note">You are observing this vote. Only members eligible for this round can cast a ballot.</p>}
        {canBreakTie && <p className="vote-decide" role="status"><span className="vote-badge vote-badge--decide">Decide now</span><span>The vote is tied. As CEO, choose which leading option the board adopts.</span></p>}
        {isTie && !canBreakTie && <p className="vote-waiting" role="status"><span className="vote-waiting-dot" aria-hidden="true" />Waiting for the CEO to break the tie{tied.length > 0 && tied.every((id) => known[id]) ? ` between ${tied.map((id) => known[id]).join(' and ')}` : ''}.</p>}

        {canVote && selfVote && !changing && <div className="vote-confirmed">
            <p><span className="vote-badge vote-badge--voted">Voted</span> Your vote: <strong>{known[selfVote] ?? 'recorded'}</strong></p>
            <button type="button" className="vote-secondary" disabled={pending} onClick={() => { setChangingPhase(game.phase_id); setDraft({ phaseId: game.phase_id, optionId: selfVote }) }}>Change vote</button>
        </div>}

        {showChoices && <>
            <div className="vote-choices" role="group" aria-label={isTie ? 'Tied options' : 'Available responses'}>
                {choices.map((option) => {
                    const badge = customOptionBadge(option, memberName, room.self_member_id)
                    // The custom badge already names the proposer, so only an explicit description is repeated.
                    const description = badge ? option.description ?? null : optionDescription(option, memberName)
                    const selected = draftId === option.option_id
                    return <motion.button
                        key={option.option_id}
                        type="button"
                        layout
                        className={`vote-choice${selected ? ' is-selected' : ''}`}
                        aria-pressed={selected}
                        disabled={pending}
                        onClick={() => setDraft({ phaseId: game.phase_id, optionId: option.option_id })}
                        whileTap={{ scale: 0.985 }}
                    >
                        <span className="vote-choice-mark" aria-hidden="true" />
                        <span className="vote-choice-body">
                            <span className="vote-choice-label">{option.kind === 'ai' && <span className="vote-ai-badge">AI suggested</span>}{badge && <span className="vote-custom-badge">{badge}</span>}{option.label}</span>
                            {description && <span className="vote-choice-description">{description}</span>}
                            {option.kind === 'ai' && option.rationale && <span className="vote-choice-rationale">Why: {option.rationale}</span>}
                            {selfVote === option.option_id && !isTie && <span className="vote-choice-tag">Your current vote</span>}
                        </span>
                    </motion.button>
                })}
                {choices.length === 0 && <p className="vote-note">No options are available for this decision.</p>}
                {proposalCard}
            </div>
            <div className="vote-confirm">
                <p aria-live="polite">{draftId ? <>Selected: <strong>{known[draftId]}</strong></> : 'Select an option to continue.'}</p>
                <div className="vote-confirm-actions">
                    {changing && <button type="button" className="vote-secondary" disabled={pending} onClick={() => { setChangingPhase(null); setDraft(null) }}>Keep my vote</button>}
                    <button type="button" className="vote-primary" disabled={pending || !draftId || (changing && draftId === selfVote)} onClick={() => void confirm()}>
                        {isTie ? 'Confirm CEO decision' : changing ? 'Confirm changed vote' : 'Confirm my vote'}
                    </button>
                </div>
            </div>
        </>}

        {!showChoices && proposalCard}

        {isVoting && <p className="vote-note">{eligible} {eligible === 1 ? 'member votes' : 'members vote'} this round. Ballots stay private until voting closes; you can change yours until the deadline.</p>}

        {progress && <div className="vote-progress">
            <span>{progress.cast} of {progress.eligible} ballots cast</span>
            <span className="vote-meter" aria-hidden="true"><motion.span initial={{ width: 0 }} animate={{ width: `${progress.share * 100}%` }} transition={{ duration: 0.5 }} /></span>
        </div>}

        {rows && <ul className="vote-tally" aria-label="Vote tally">
            {rows.map((row) => {
                const isWinner = winner?.selected_option_label === row.label
                const isTied = isTie && tied.includes(row.option_id)
                return <li key={row.option_id} className={`${isWinner ? 'is-winner' : ''}${isTied ? ' is-tied' : ''}${row.leading ? ' is-leading' : ''}`}>
                    <span className="vote-tally-label">{row.label}{isWinner && <span className="vote-badge vote-badge--winner">Adopted</span>}</span>
                    <span className="vote-tally-count">{row.count} {row.count === 1 ? 'vote' : 'votes'}</span>
                    <span className="vote-tally-bar" aria-hidden="true"><motion.span initial={{ width: 0 }} animate={{ width: `${row.share * 100}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} /></span>
                </li>
            })}
        </ul>}
        {!rows && game.vote_counts && Object.keys(game.vote_counts).length > 0 && <p className="vote-note">{voteCountSummary(game.vote_counts, options)}</p>}

        {winner && <motion.div className="vote-winner" role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <span className="vote-eyebrow">The board decided</span>
            <strong>{winner.selected_option_label ?? 'No decision was reached'}</strong>
            <small>{winner.selection_method.replaceAll('_', ' ')}</small>
        </motion.div>}
        {resolution?.tone === 'pending' && <p className="vote-waiting" role="status"><span className="vote-waiting-dot" aria-hidden="true" />{resolution.text}</p>}
        {resolution?.tone === 'failed' && <p className="vote-custom-error" role="alert">{resolution.text}</p>}
        {isResult && !winner && phase === 'resolving' && !resolution && <p className="vote-waiting" role="status"><span className="vote-waiting-dot" aria-hidden="true" />The custom action is being evaluated.</p>}
    </section>
}
