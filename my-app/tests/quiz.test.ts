import assert from 'node:assert/strict'
import test from 'node:test'
import {
    QUIZ_MAX, answeredCount, botChoice, canChoose, choiceLetter, currentQuestion, earnedText, focusQuestion, lastAnswered, normalizeQuiz,
    questionHeading, quizChips, quizScoreText, quizStatusText, reviewQuestions, totalText,
} from '../src/features/game/quizModel.ts'
import { botPrivateStep, initiallySpoken, normalizePrivateSession, privateStatusText, shouldPollPrivate } from '../src/features/game/privateSessionModel.ts'
import type { PrivateMessage, PrivateQuiz } from '../src/services/facilitation.ts'

const choices = [{ choice_id: 'a', text: 'Wait for the vendor' }, { choice_id: 'b', text: 'Escalate to the deputy' }, { choice_id: 'c', text: 'Announce a fix' }, { choice_id: 'd', text: 'Do nothing' }]
const answered = (step: number, chosen: string, points: number) => ({ step, question: `Question ${step}?`, choices, chosen, points, max: 20 })
const open = (step: number) => ({ step, question: `Question ${step}?`, choices, chosen: null, points: null, max: 20 })

function quiz(change: Record<string, unknown> = {}): PrivateQuiz {
    const value = normalizeQuiz({ status: 'ready', current: 3, questions: [answered(1, 'b', 20), answered(2, 'a', 12), open(3)], total: 32, max: 100, review: null, ...change })
    assert.ok(value)
    return value
}

const agent = (id: string, kind: PrivateMessage['kind'], step: number | null = null, round: 2 | 3 = 3): PrivateMessage =>
    ({ message_id: id, author: 'agent', kind, round, step, text: `${id} text`, status: 'ready', source: 'vertex', speech_id: `s-${id}`, at: '' })

test('quiz payloads are read defensively', () => {
    assert.equal(normalizeQuiz(null), null)
    assert.equal(normalizeQuiz([]), null)
    const minimal = normalizeQuiz({})
    assert.deepEqual(minimal, { status: 'generating', current: null, questions: [], total: 0, max: QUIZ_MAX, review: null })
    // Questions arrive sorted by step; choices without an id are dropped; points are ignored until a pick exists.
    const messy = normalizeQuiz({ status: 'ready', current: 2, questions: [{ step: 2, question: 'Two?', choices: [...choices, { text: 'no id' }], points: 15 }, answered(1, 'c', 0)] })
    assert.ok(messy)
    assert.deepEqual(messy.questions.map((item) => item.step), [1, 2])
    assert.equal(messy.questions[1].choices.length, 4)
    assert.equal(messy.questions[1].points, null)
    assert.equal(messy.total, 0)
    // Current is only meaningful when the quiz is ready.
    assert.equal(normalizeQuiz({ status: 'failed', current: 2 })?.current, null)
    assert.equal(normalizeQuiz({ status: 'weird' })?.status, 'generating')
})

test('the current question, the last answer and the focused card', () => {
    const value = quiz()
    assert.equal(currentQuestion(value)?.step, 3)
    assert.equal(lastAnswered(value)?.step, 2)
    assert.equal(answeredCount(value), 2)
    // While the examiner is still speaking the card keeps the last result; once caught up it moves on.
    assert.equal(focusQuestion(value, false)?.step, 2)
    assert.equal(focusQuestion(value, true)?.step, 3)
    // Before any answer there is nothing to show until the first question has been read.
    const first = quiz({ current: 1, questions: [open(1)], total: 0 })
    assert.equal(focusQuestion(first, false), null)
    assert.equal(focusQuestion(first, true)?.step, 1)
    // Complete: no current question, the last result stays.
    const done = quiz({ current: null, questions: [1, 2, 3, 4, 5].map((step) => answered(step, 'a', 20)), total: 100 })
    assert.equal(currentQuestion(done), null)
    assert.equal(focusQuestion(done, true)?.step, 5)
    assert.equal(currentQuestion(quiz({ status: 'generating' })), null)
    assert.equal(currentQuestion(null), null)
})

test('a choice can be sent only for the current unanswered question while nothing else is in flight', () => {
    const value = quiz()
    assert.equal(canChoose(value, value.questions[2], false), true)
    assert.equal(canChoose(value, value.questions[2], true), false)
    assert.equal(canChoose(value, value.questions[1], false), false)
    assert.equal(canChoose(quiz({ status: 'failed' }), value.questions[2], false), false)
})

test('labels: letters, headings, earned points, totals and chips', () => {
    assert.equal(choiceLetter('c', 0), 'C')
    assert.equal(choiceLetter('x1', 3), 'D')
    assert.equal(questionHeading(2), 'Question 2 of 5')
    const value = quiz()
    assert.equal(earnedText(value.questions[1]), 'You earned 12 of 20')
    assert.equal(totalText(value), 'Total 32 of 100')
    assert.equal(quizScoreText(value), 'Score 32 / 100')
    assert.deepEqual(quizChips(value).map((chip) => [chip.text, chip.status]), [
        ['20 / 20', 'scored'], ['12 / 20', 'scored'], ['- / 20', 'current'], ['- / 20', 'waiting'], ['- / 20', 'waiting'],
    ])
    assert.equal(quizChips(normalizeQuiz({ status: 'generating' })!).length, 5)
    assert.equal(quizStatusText(value), 'assessment 3/5')
    assert.equal(quizStatusText(normalizeQuiz({ status: 'generating' })!), 'assessment 1/5')
})

test('the released review marks the pick and the best choice in text, in step order', () => {
    const review = [
        { step: 2, question: 'Two?', chosen: 'a', points: 12, choices: [
            { choice_id: 'a', text: 'Wait', points: 12, rationale: 'Partial' }, { choice_id: 'b', text: 'Escalate', points: 20, rationale: 'Best' },
            { choice_id: 'c', text: 'Announce', points: 0, rationale: 'Invents facts' }, { choice_id: 'd', text: 'Nothing', points: 5, rationale: 'Too slow' },
        ] },
        { step: 1, question: 'One?', chosen: 'b', points: 20, choices: [
            { choice_id: 'a', text: 'A', points: 8, rationale: 'r' }, { choice_id: 'b', text: 'B', points: 20, rationale: 'r' },
            { choice_id: 'c', text: 'C', points: 0, rationale: 'r' }, { choice_id: 'd', text: 'D', points: 15, rationale: 'r' },
        ] },
    ]
    const items = reviewQuestions(quiz({ review }))
    assert.deepEqual(items.map((item) => item.step), [1, 2])
    assert.equal(items[0].heading, 'Question 1 · 20 / 20')
    assert.deepEqual(items[0].choices.find((choice) => choice.choiceId === 'b')?.tags, ['Your answer', 'Best answer'])
    const second = items[1]
    assert.equal(second.released, true)
    assert.equal(second.heading, 'Question 2 · 12 / 20')
    assert.deepEqual(second.choices.map((choice) => [choice.letter, choice.points, choice.tags]), [
        ['A', 12, ['Your answer']], ['B', 20, ['Best answer']], ['C', 0, []], ['D', 5, []],
    ])
    assert.equal(second.choices[2].rationale, 'Invents facts')
})

test('without the review (ended early) only answered questions and the earned points appear', () => {
    const items = reviewQuestions(quiz())
    assert.deepEqual(items.map((item) => item.step), [1, 2])
    assert.equal(items[1].released, false)
    assert.deepEqual(items[1].choices.map((choice) => choice.points), [12, null, null, null])
    assert.equal(items[1].choices.some((choice) => choice.best), false)
    assert.deepEqual(items[1].choices[0].tags, ['Your answer'])
})

test('bots spread their picks deterministically', () => {
    assert.equal(botChoice(open(1), 0), 'b')
    assert.equal(botChoice(open(1), 1), 'c')
    assert.equal(botChoice(open(4), 0), 'a')
    assert.equal(botChoice({ step: 1, choices: [] }), null)
})

function session(change: Record<string, unknown> = {}) {
    const value = normalizePrivateSession({
        round: 3, stage: 'assessment', agent: { label: 'Crisis coach', role: 'examiner' }, decision_text: 'x', messages: [], expecting: null, busy: false,
        clip: null, card: null, assessment: { stages: [], total: 0, max: 100, feedback: null }, retryable: false,
        quiz: { status: 'ready', current: 3, questions: [answered(1, 'b', 20), answered(2, 'a', 12), open(3)], total: 32, max: 100, review: null }, ...change,
    })
    assert.ok(value)
    return value
}

test('the private session carries the quiz into polling, progress and the bot loop', () => {
    assert.equal(session().quiz?.current, 3)
    assert.equal(session({ quiz: undefined }).quiz, null)
    assert.equal(shouldPollPrivate(session()), false)
    assert.equal(shouldPollPrivate(session({ quiz: { status: 'generating' } })), true)
    assert.equal(privateStatusText(session()), 'assessment 3/5')
    const fallback = () => 'typed'
    assert.deepEqual(botPrivateStep(session(), new Set(), fallback, 1), { kind: 'choose', key: 'choice:3', step: 3, choiceId: 'a' })
    assert.deepEqual(botPrivateStep(session(), new Set(['choice:3']), fallback), { kind: 'wait' })
    assert.deepEqual(botPrivateStep(session({ quiz: { status: 'generating' }, busy: true }), new Set(), fallback), { kind: 'wait' })
    assert.equal(botPrivateStep(session({ quiz: { status: 'failed' }, retryable: true }), new Set(), fallback).kind, 'retry')
})

test('a reload in the quiz replays only the current question; a finished quiz replays nothing', () => {
    const messages = [agent('r2q', 'question', 1, 2), agent('transition', 'transition'), agent('q1', 'question', 1), agent('res1', 'result', 1), agent('q2', 'question', 2)]
    const current = quiz({ current: 2, questions: [answered(1, 'a', 12), open(2)], total: 12 })
    assert.deepEqual([...initiallySpoken(messages, current)], ['r2q', 'transition', 'q1', 'res1'])
    const done = quiz({ current: null, questions: [1, 2, 3, 4, 5].map((step) => answered(step, 'a', 20)), total: 100 })
    assert.equal(initiallySpoken(messages, done).size, messages.length)
    // Without a quiz (or while generating) the old rule applies: nothing before a member answer, so everything plays.
    assert.equal(initiallySpoken(messages).size, 0)
    assert.equal(initiallySpoken(messages, quiz({ status: 'generating' })).size, 0)
})
