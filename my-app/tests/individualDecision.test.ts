import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DECISION_LIMIT, DECISION_PROMPT, boardRows, canSubmitDecision, decisionBadges, endingTitle, isIndividualMode, roundLabel, submittedCount,
} from '../src/features/game/individualDecisionModel.ts'
import type { IndividualDecisions } from '../src/services/rooms.ts'

const decisions = (self: IndividualDecisions['self'], submitted: Record<string, boolean>): IndividualDecisions => ({
    submitted: Object.entries(submitted).map(([id, done]) => ({ member_id: id, display_name: id.toUpperCase(), role_name: `${id} role`, submitted: done })),
    self,
})

test('individual mode is opt in and vote mode stays the default', () => {
    assert.equal(isIndividualMode({ decision_mode: 'individual' }), true)
    assert.equal(isIndividualMode({ decision_mode: 'vote' }), false)
    assert.equal(isIndividualMode({}), false)
    assert.equal(isIndividualMode(null), false)
})

test('a decision needs text within the limit that differs from the recorded one', () => {
    assert.equal(canSubmitDecision('  '), false)
    assert.equal(canSubmitDecision('I would verify backups.'), true)
    assert.equal(canSubmitDecision('x'.repeat(DECISION_LIMIT + 1)), false)
    assert.equal(canSubmitDecision(' Same text ', 'Same text'), false)
    assert.equal(canSubmitDecision('New text', 'Same text'), true)
    assert.match(DECISION_PROMPT, /^I would… because… using… I still need to establish…$/)
})

test('board rows show only submission status, counting the caller once recorded', () => {
    const rows = boardRows(decisions({ text: 'mine', at: '' }, { a: false, b: true, c: false }), 'a')
    assert.deepEqual(rows.map((row) => [row.member_id, row.submitted, row.self]), [['a', true, true], ['b', true, false], ['c', false, false]])
    assert.deepEqual(rows[1], { member_id: 'b', name: 'B', role: 'b role', submitted: true, self: false })
    assert.deepEqual(submittedCount(rows), { done: 2, total: 3 })
    assert.deepEqual(boardRows(null, 'a'), [])
    assert.deepEqual(boardRows(undefined, 'a'), [])
})

test('decision badges mark every listed member, and the caller even when unlisted', () => {
    assert.deepEqual(decisionBadges(decisions(null, { a: false, b: true }), 'a'), { a: { label: 'Writing…', tone: 'decide' }, b: { label: 'Submitted', tone: 'voted' } })
    assert.deepEqual(decisionBadges(decisions(null, {}), 'a'), { a: { label: 'Decide now', tone: 'decide' } })
    assert.deepEqual(decisionBadges(decisions({ text: 't', at: '' }, {}), 'a'), { a: { label: 'Submitted', tone: 'voted' } })
    assert.deepEqual(decisionBadges(null, 'a'), {})
})

test('the round label appears only in individual games during round one', () => {
    for (const phase of ['briefing', 'speaking', 'discussion', 'individual_decision']) assert.equal(roundLabel(phase, { decision_mode: 'individual' }), 'Round 1 · Board discussion')
    assert.equal(roundLabel('ended', { decision_mode: 'individual' }), null)
    assert.equal(roundLabel('speaking', { decision_mode: 'vote' }), null)
    assert.equal(roundLabel('speaking', undefined), null)
})

test('the ended heading reads the server ending label', () => {
    assert.equal(endingTitle('Individual decisions recorded'), 'Individual decisions recorded')
    assert.equal(endingTitle('individual_decisions_recorded'), 'Individual decisions recorded')
    assert.equal(endingTitle(null), 'Individual decisions recorded')
})
