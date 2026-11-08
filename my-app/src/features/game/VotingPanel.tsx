import { useState } from 'react'
import { motion } from 'motion/react'
import type { RoomSnapshot } from '../../services/rooms'
import Countdown from './Countdown'
import { voteCountSummary } from './votePresentation'
import { ballotProgress, mergeLabels, optionDescription, tallyRows } from './votingModel'
import type { ChoiceOption } from './votingModel'

const RESULT_PHASES = ['resolving', 'resolution_failed', 'decision', 'result']

type Act = (path: string, fields?: Record<string, unknown>) => Promise<boolean>

export default function VotingPanel({ room, pending, act }: { room: RoomSnapshot; pending: boolean; act: Act }) {
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
    if (!isVoting && !isTie && !isResult) return null

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
            </div>
            {(isVoting || isTie) && <Countdown key={game.phase_id + (game.server_time ?? '')} deadline={game.phase_deadline} serverTime={game.server_time} className="vote-countdown" />}
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
                    const description = optionDescription(option, memberName)
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
                            <span className="vote-choice-label">{option.label}</span>
                            {description && <span className="vote-choice-description">{description}</span>}
                            {selfVote === option.option_id && !isTie && <span className="vote-choice-tag">Your current vote</span>}
                        </span>
                    </motion.button>
                })}
                {choices.length === 0 && <p className="vote-note">No options are available for this decision.</p>}
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
        {isResult && !winner && phase === 'resolving' && <p className="vote-waiting" role="status"><span className="vote-waiting-dot" aria-hidden="true" />The custom action is being evaluated.</p>}
    </section>
}
