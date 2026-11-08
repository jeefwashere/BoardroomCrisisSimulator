import test from 'node:test'
import assert from 'node:assert/strict'
import {
    aiOptionsNotice, ballotProgress, customOptionBadge, mergeLabels, optionDescription, ownCustomOption, proposalDraft, resolutionNotice, tallyRows,
} from '../src/features/game/votingModel.ts'

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

test('custom ballot options are found, badged and prefilled for the proposer', () => {
    const names = (id: string) => (id === 'm2' ? 'Ada' : undefined)
    const options = [
        { option_id: 'a', label: 'Preserve evidence', kind: 'prepared' },
        { option_id: 'c1', label: 'Call the regulator', kind: 'custom', member_id: 'm2' },
        { option_id: 'c2', label: 'Pay nothing', kind: 'custom', member_id: 'm1', description: 'Refuse the ransom outright.' },
    ]
    assert.equal(ownCustomOption(options, 'm1')?.option_id, 'c2')
    assert.equal(ownCustomOption(options, 'm3'), null)
    assert.equal(customOptionBadge(options[0], names, 'm1'), null)
    assert.equal(customOptionBadge(options[1], names, 'm1'), 'Custom · proposed by Ada')
    assert.equal(customOptionBadge(options[2], names, 'm1'), 'Your custom option')
    assert.equal(customOptionBadge({ option_id: 'x', label: 'X', kind: 'custom', member_id: 'gone' }, names, 'm1'), 'Custom')
    assert.equal(proposalDraft(options[2], [{ option_id: 'c2', text: 'Pay nothing, rebuild from backups' }]), 'Pay nothing, rebuild from backups')
    assert.equal(proposalDraft(options[2], []), 'Refuse the ransom outright.')
    assert.equal(proposalDraft(options[1], undefined), 'Call the regulator')
    assert.equal(proposalDraft(null, []), '')
})

test('resolution notices cover mapping, failure and quiet phases', () => {
    assert.equal(resolutionNotice(null, 'resolving'), null)
    assert.equal(resolutionNotice({ status: 'pending', error: null }, 'voting'), null)
    assert.deepEqual(resolutionNotice({ status: 'pending', error: null }, 'resolving'), { text: 'AI is mapping the winning custom option to an outcome…', tone: 'pending' })
    assert.equal(resolutionNotice({ status: 'failed', error: 'timeout' }, 'resolution_failed')?.text, 'The AI could not map the winning custom option to an outcome: timeout')
    assert.equal(resolutionNotice({ status: 'ready', error: null }, 'result'), null)
})
