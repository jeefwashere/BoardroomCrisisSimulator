import assert from 'node:assert/strict'
import test from 'node:test'
import {
    CARD_FIELDS, botPrivateStep, canConfirmCard, canSubmitAnswer, emptyCardFields, expectingKey, feedbackHeading, initiallySpoken, nextToSpeak,
    normalizePrivateSession, ownPrivateRound, privateRoundLabel, privateStatusText, progressStatus, progressText, runningScore, scoreText,
    questionText, shouldPollPrivate, stageChips, transitionIndex, trimCard, allComplete,
} from '../src/features/game/privateSessionModel.ts'
import type { PrivateMessage, PrivateSession } from '../src/services/facilitation.ts'

const agent = (id: string, kind: PrivateMessage['kind'], round: 2 | 3 = 2, extra: Partial<PrivateMessage> = {}): PrivateMessage =>
    ({ message_id: id, author: 'agent', kind, round, step: null, text: `${id} text`, status: 'ready', source: 'vertex', speech_id: `s-${id}`, at: '', ...extra })
const member = (id: string, round: 2 | 3 = 2, step = 1): PrivateMessage =>
    ({ message_id: id, author: 'member', kind: 'answer', round, step, text: `${id} answer`, status: 'ready', source: null, speech_id: null, at: '' })

function session(change: Record<string, unknown> = {}): PrivateSession {
    const value = normalizePrivateSession({
        round: 2, stage: 'coaching', agent: { label: 'Crisis coach', role: 'coach' }, decision_text: 'My decision', messages: [], expecting: null, busy: false,
        clip: null, card: null, assessment: { stages: [{ step: 1, max: 30, points: null, status: 'waiting' }, { step: 2, max: 40, points: null, status: 'waiting' }, { step: 3, max: 30, points: null, status: 'waiting' }], total: null, max: 100, feedback: null },
        retryable: false, ...change,
    })
    assert.ok(value)
    return value
}

test('payloads are read defensively: unknown stages are rejected, missing parts get safe defaults', () => {
    assert.equal(normalizePrivateSession(null), null)
    assert.equal(normalizePrivateSession({ stage: 'lobby', messages: [] }), null)
    assert.equal(normalizePrivateSession({ stage: 'coaching' }), null)
    const minimal = normalizePrivateSession({ stage: 'assessment', messages: [{ author: 'agent', text: 'Hi' }, { author: 'robot', text: 'x' }, { author: 'member' }] })
    assert.ok(minimal)
    assert.equal(minimal.round, 3)
    assert.equal(minimal.agent.label, 'Crisis coach')
    assert.equal(minimal.messages.length, 1)
    assert.equal(minimal.messages[0].status, 'ready')
    assert.equal(minimal.messages[0].message_id, 'message-0')
    assert.deepEqual(minimal.assessment.stages.map((stage) => stage.max), [30, 40, 30])
    assert.equal(minimal.clip, null)
    // A clip without an audio URL or caption cannot be auto played.
    assert.equal(session({ clip: { clip_id: 'c', audio_url: '', text: 'x' } }).clip, null)
    assert.equal(session({ clip: { clip_id: 'c', audio_url: '/a.mp3', text: 'Saved', duration_seconds: 4 } }).clip?.text, 'Saved')
    const card = session({ stage: 'card', card: { status: 'draft', fields: { action: 'Act', review: 3 } } }).card
    assert.equal(card?.fields.action, 'Act')
    assert.equal(card?.fields.review, '')
})

test('polling continues only while the coach is working', () => {
    assert.equal(shouldPollPrivate(null), true)
    assert.equal(shouldPollPrivate(session()), false)
    assert.equal(shouldPollPrivate(session({ busy: true })), true)
    assert.equal(shouldPollPrivate(session({ messages: [agent('a', 'question', 2, { status: 'pending' })] })), true)
    assert.equal(shouldPollPrivate(session({ stage: 'card', card: { status: 'drafting', fields: {} } })), true)
    assert.equal(shouldPollPrivate(session({ stage: 'assessment', round: 3, assessment: { stages: [{ step: 1, max: 30, points: null, status: 'scoring' }] } })), true)
})

test('round labels, running score and stage chips', () => {
    assert.equal(privateRoundLabel(2), 'Round 2 · Private coaching')
    assert.equal(privateRoundLabel(3), 'Round 3 · Assessment')
    const scored = session({ round: 3, stage: 'assessment', assessment: { stages: [{ step: 1, max: 30, points: 24, status: 'scored' }, { step: 2, max: 40, points: null, status: 'scoring' }, { step: 3, max: 30, points: null, status: 'waiting' }], total: null, max: 100 } })
    assert.equal(runningScore(scored.assessment), 24)
    assert.equal(scoreText(scored.assessment), 'Score 24 / 100')
    assert.deepEqual(stageChips(scored.assessment).map((chip) => chip.text), ['24 / 30', '… / 40', '– / 30'])
    assert.equal(stageChips(scored.assessment)[1].title, 'Respond to a challenge')
    // The server total wins when given.
    assert.equal(runningScore({ ...scored.assessment, total: 61 }), 61)
    assert.equal(feedbackHeading({ step: 1, criteria: [] }, scored.assessment), 'Stage 1 · Explain your decision · 24 / 30')
})

test('the own round comes from the session, else from the room progress', () => {
    assert.equal(ownPrivateRound(session({ round: 3, stage: 'assessment' }), null, 'a'), 3)
    const progress = [{ member_id: 'a', display_name: 'A', role_name: 'CEO', stage: 'complete' as const }, { member_id: 'b', display_name: 'B', role_name: 'IT', stage: 'card' as const }]
    assert.equal(ownPrivateRound(null, progress, 'a'), 3)
    assert.equal(ownPrivateRound(null, progress, 'b'), 2)
    assert.equal(ownPrivateRound(null, undefined, 'b'), 2)
    assert.equal(allComplete(progress), false)
    assert.equal(allComplete(progress.map((item) => ({ ...item, stage: 'complete' as const }))), true)
    assert.equal(allComplete([]), false)
    assert.equal(progressText('card'), 'Response card')
    assert.equal(progressStatus('not_started'), 'starting…')
    assert.equal(progressStatus('assessment'), 'assessment')
})

test('voice queue: a reload only replays lines after the latest answer, played in order, failures skipped', () => {
    const messages = [agent('twist', 'twist'), agent('q1', 'question'), member('a1'), agent('ack', 'ack'), agent('q2', 'question')]
    const spoken = initiallySpoken(messages)
    assert.deepEqual([...spoken], ['twist', 'q1'])
    assert.equal(nextToSpeak(messages, spoken)?.message_id, 'ack')
    assert.equal(nextToSpeak(messages, new Set([...spoken, 'ack']))?.message_id, 'q2')
    assert.equal(nextToSpeak(messages, new Set([...spoken, 'ack', 'q2'])), null)
    // A fresh session voices everything; a pending reply holds the queue; a failed one is skipped.
    assert.equal(initiallySpoken([agent('twist', 'twist')]).size, 0)
    assert.equal(nextToSpeak([agent('p', 'question', 2, { status: 'pending' }), agent('x', 'ack')], new Set())?.message_id, 'p')
    assert.equal(nextToSpeak([agent('f', 'question', 2, { status: 'failed' }), agent('x', 'ack')], new Set())?.message_id, 'x')
})

test('the hand over to the examiner is the transition message, else the first Round 3 line', () => {
    assert.equal(transitionIndex([agent('q', 'question'), member('a'), agent('t', 'transition', 3), agent('s1', 'question', 3)]), 2)
    assert.equal(transitionIndex([agent('q', 'question'), member('a'), agent('s1', 'question', 3)]), 2)
    assert.equal(transitionIndex([agent('q', 'question')]), -1)
})

test('answers and cards are validated and trimmed', () => {
    assert.equal(canSubmitAnswer('  '), false)
    assert.equal(canSubmitAnswer('I would call the deputy.'), true)
    assert.equal(canSubmitAnswer('x'.repeat(1201)), false)
    const fields = emptyCardFields()
    assert.equal(canConfirmCard(fields), false)
    // The server requires all seven fields.
    assert.equal(canConfirmCard({ ...fields, action: 'Engage the provider' }), false)
    const full = Object.fromEntries(CARD_FIELDS.map(({ key }) => [key, 'Set'])) as ReturnType<typeof emptyCardFields>
    assert.equal(canConfirmCard(full), true)
    assert.equal(canConfirmCard({ ...full, review: '   ' }), false)
    assert.equal(canConfirmCard({ ...full, review: 'x'.repeat(601) }), false)
    assert.equal(trimCard({ ...fields, action: '  Act  ' }).action, 'Act')
    assert.deepEqual(CARD_FIELDS.map((field) => field.label), ['Action', 'Responsibility', 'Evidence', 'Dependencies', 'Fallback', 'Communication', 'Review'])
    assert.equal(expectingKey(session({ expecting: { round: 2, step: 2, question: 'Q?' } })), '2:2')
    assert.equal(expectingKey(session()), null)
    // The composer shows the short question; the development before it is already in the transcript.
    const asked = session({ expecting: { round: 2, step: 1, question: 'Twist. What next?' }, messages: [agent('t', 'twist'), agent('q', 'question', 2, { step: 1, text: 'What next?' })] })
    assert.equal(questionText(asked), 'What next?')
    assert.equal(questionText(session({ expecting: { round: 3, step: 1, question: 'Explain.' } })), 'Explain.')
})

test('branch status reads coaching, card, assessment and complete', () => {
    assert.equal(privateStatusText(session({ expecting: { round: 2, step: 2, question: 'Q?' } })), 'coaching 2/3')
    assert.equal(privateStatusText(session({ busy: true, messages: [agent('q', 'question'), member('a1')] })), 'coaching 2/3')
    assert.equal(privateStatusText(session({ stage: 'card' })), 'response card')
    assert.equal(privateStatusText(session({ round: 3, stage: 'assessment', expecting: { round: 3, step: 1, question: 'Explain' } })), 'assessment 1/3')
    assert.equal(privateStatusText(session({ round: 3, stage: 'assessment', assessment: { stages: [{ step: 1, max: 30, points: 20, status: 'scored' }, { step: 2, max: 40, points: null, status: 'scoring' }, { step: 3, max: 30, points: null, status: 'waiting' }] } })), 'assessment 3/3')
    assert.equal(privateStatusText(session({ round: 3, stage: 'complete' })), 'complete')
})

test('automated members answer each question once, confirm the drafted card and stop when complete', () => {
    const fallback = (round: 2 | 3, step: number) => `fallback ${round}.${step}`
    const handled = new Set<string>()
    const withClip = session({ expecting: { round: 2, step: 1, question: 'Q?' }, clip: { clip_id: 'c1', audio_url: '/c1.mp3', text: 'Saved answer' } })
    assert.deepEqual(botPrivateStep(withClip, handled, fallback), { kind: 'answer', key: 'answer:2:1', text: 'Saved answer', usedClip: true })
    handled.add('answer:2:1')
    assert.deepEqual(botPrivateStep(withClip, handled, fallback), { kind: 'wait' })
    const noClip = session({ round: 3, stage: 'assessment', expecting: { round: 3, step: 2, question: 'Q?' } })
    assert.deepEqual(botPrivateStep(noClip, handled, fallback), { kind: 'answer', key: 'answer:3:2', text: 'fallback 3.2', usedClip: false })
    assert.deepEqual(botPrivateStep(session({ busy: true, expecting: { round: 2, step: 2, question: 'Q?' } }), handled, fallback), { kind: 'wait' })
    const draft = session({ stage: 'card', card: { status: 'draft', fields: { action: ' Act ', responsibility: 'Deputy' } } })
    const step = botPrivateStep(draft, handled, fallback)
    assert.equal(step.kind, 'card')
    assert.equal(step.kind === 'card' && step.fields.action, 'Act')
    assert.equal(step.kind === 'card' && step.fields.review, 'Needs confirmation')
    assert.deepEqual(botPrivateStep(draft, new Set(['card']), fallback), { kind: 'wait' })
    assert.deepEqual(botPrivateStep(session({ stage: 'card', card: { status: 'drafting', fields: {} } }), handled, fallback), { kind: 'wait' })
    const failed = session({ retryable: true, messages: [agent('q', 'question', 2, { status: 'failed' })] })
    const retry = botPrivateStep(failed, handled, fallback)
    assert.equal(retry.kind, 'retry')
    assert.deepEqual(botPrivateStep(failed, new Set([retry.kind === 'retry' ? retry.key : '']), fallback), { kind: 'wait' })
    assert.deepEqual(botPrivateStep(session({ stage: 'complete', round: 3 }), handled, fallback), { kind: 'done' })
})
