import test from 'node:test'
import assert from 'node:assert/strict'
import { voteCountSummary } from '../src/features/game/votePresentation.ts'

test('result and ended snapshots without options show recorded ballot total without raw IDs', () => {
    const summary = voteCountSummary({ contain_targeted: 1, contain_wait: 1, contain_broad: 0 })
    assert.equal(summary, 'Recorded ballots: 2.')
    assert.doesNotMatch(summary, /contain_/)
})

test('current prepared options retain their actual human labels and counts', () => {
    assert.equal(voteCountSummary({ action_a: 3, action_b: 1 }, [
        { option_id: 'action_a', label: 'Preserve evidence' }, { option_id: 'action_b', label: 'Wait for more information' },
    ]), 'Final vote counts: Preserve evidence: 3, Wait for more information: 1')
})

test('partial option labels use the complete total rather than exposing an unmatched identifier', () => {
    assert.equal(voteCountSummary({ action_a: 2, action_b: 2 }, [{ option_id: 'action_a', label: 'Preserve evidence' }]), 'Recorded ballots: 4.')
})
