import test from 'node:test'
import assert from 'node:assert/strict'
import { aiOptionsNotice, ballotProgress, mergeLabels, optionDescription, tallyRows } from '../src/features/game/votingModel.ts'

test('ballot progress stays unknown while the server hides the tally', () => {
    assert.equal(ballotProgress(null, 4), null)
    assert.deepEqual(ballotProgress({ a: 2, b: 1 }, 4), { cast: 3, eligible: 4, share: 0.75 })
    assert.equal(ballotProgress({ a: 1 }, 0)?.share, 0)
})

test('tally rows use human labels, mark every leader and never expose raw option IDs', () => {
    const rows = tallyRows({ a: 2, b: 2, c: 0 }, { a: 'Preserve evidence', b: 'Restore service', c: 'Wait' })
    assert.deepEqual(rows?.map((row) => [row.label, row.count, row.leading]), [['Preserve evidence', 2, true], ['Restore service', 2, true], ['Wait', 0, false]])
    assert.equal(rows?.[0].share, 0.5)
    assert.equal(tallyRows({ a: 1, unknown_id: 1 }, { a: 'Preserve evidence' }), null)
    assert.equal(tallyRows({ a: 0 }, { a: 'Preserve evidence' })?.[0].leading, false)
})

test('custom options describe their proposer and labels merge only when changed', () => {
    const names = (id: string) => (id === 'm1' ? 'Ada' : undefined)
    assert.equal(optionDescription({ option_id: 'x', label: 'Call regulator', kind: 'custom', member_id: 'm1' }, names), 'Custom action proposed by Ada.')
    assert.equal(optionDescription({ option_id: 'y', label: 'Prepared', kind: 'prepared' }, names), null)
    const known = { a: 'Preserve evidence' }
    assert.equal(mergeLabels(known, [{ option_id: 'a', label: 'Preserve evidence' }]), null)
    assert.deepEqual(mergeLabels(known, [{ option_id: 'b', label: 'Wait' }]), { a: 'Preserve evidence', b: 'Wait' })
})

test('aiOptionsNotice reports agent drafting and fallback states', () => {
    assert.equal(aiOptionsNotice({ ballot_source: 'authored', ai_options_status: 'disabled' }, 'speaking'), null)
    assert.match(aiOptionsNotice({ ballot_source: 'ai', ai_options_status: 'pending' }, 'speaking') ?? '', /drafting/)
    assert.match(aiOptionsNotice({ ballot_source: 'ai', options_source: 'ai' }, 'voting') ?? '', /AI agents/)
    assert.match(aiOptionsNotice({ ballot_source: 'ai', options_source: 'prepared_fallback' }, 'voting') ?? '', /prepared/)
    assert.equal(aiOptionsNotice(null, 'voting'), null)
})
