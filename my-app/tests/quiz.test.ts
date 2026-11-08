import assert from 'node:assert/strict'
import test from 'node:test'
import {
    QUESTION_SECONDS, QUIZ_MAX, botChoice, canChoose, choiceLetter, closedCount, countdownAnnouncement, countdownFraction, countdownLabel, countdownPhase,
    currentQuestion, earnedText, focusQuestion, lastClosed, normalizeQuiz, previousResult, previousResultText, questionHeading, quizChips, quizFinished,
    quizScoreText, quizStatusText, remainingMs, reviewQuestions, secondsLeft, totalText,
} from '../src/features/game/quizModel.ts'
import { privateEntry } from '../src/features/game/transcriptModel.ts'
import { startAtInput } from '../src/features/demo/demoModel.ts'
import { botPrivateStep, initiallySpoken, normalizePrivateSession, privateStatusText, shouldPollPrivate } from '../src/features/game/privateSessionModel.ts'
import type { PrivateMessage, PrivateQuiz } from '../src/services/facilitation.ts'

const choices = [{ choice_id: 'a', text: 'Wait for the vendor' }, { choice_id: 'b', text: 'Escalate to the deputy' }, { choice_id: 'c', text: 'Announce a fix' }, { choice_id: 'd', text: 'Do nothing' }]
const answered = (step: number, chosen: string, points: number) => ({ step, question: `Question ${step}?`, choices, chosen, points, max: 20, deadline: '2026-11-08T12:00:00Z', timed_out: false })
const open = (step: number, deadline = '2026-11-08T12:01:00Z') => ({ step, question: `Question ${step}?`, choices, chosen: null, points: null, max: 20, deadline, timed_out: false })
const timedOut = (step: number) => ({ step, question: `Question ${step}?`, choices, chosen: null, points: 0, max: 20, deadline: '2026-11-08T12:00:00Z', timed_out: true })

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
    assert.deepEqual(minimal, { status: 'generating', current: null, questions: [], total: 0, max: QUIZ_MAX, question_seconds: QUESTION_SECONDS, server_time: null, review: null })
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

test('the current question, the last result and the focused card', () => {
    const value = quiz()
    assert.equal(currentQuestion(value)?.step, 3)
    assert.equal(lastClosed(value)?.step, 2)
    assert.equal(closedCount(value), 2)
    // The current question shows at once (no waiting for the examiner's voice); the previous result sits above it.
    assert.equal(focusQuestion(value)?.step, 3)
    assert.equal(previousResult(value)?.step, 2)
    const first = quiz({ current: 1, questions: [open(1)], total: 0 })
    assert.equal(focusQuestion(first)?.step, 1)
    assert.equal(previousResult(first), null)
    // Finished: no current question, the last result stays on the card.
    const done = quiz({ current: null, questions: [1, 2, 3, 4, 5].map((step) => answered(step, 'a', 20)), total: 100 })
    assert.equal(currentQuestion(done), null)
    assert.equal(quizFinished(done), true)
    assert.equal(quizFinished(value), false)
    assert.equal(focusQuestion(done)?.step, 5)
    assert.equal(previousResult(done), null)
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
    assert.equal(items[0].timedOut, false)
    assert.equal(items[1].released, false)
    assert.deepEqual(items[1].choices.map((choice) => choice.points), [12, null, null, null])
    assert.equal(items[1].choices.some((choice) => choice.best), false)
    assert.deepEqual(items[1].choices[0].tags, ['Your answer'])
})

test('the countdown corrects for clock skew, never goes below zero and turns urgent under ten seconds', () => {
    // The server says 60 s are left; local clocks do not matter, only the time elapsed since the payload arrived.
    assert.equal(remainingMs('2026-11-08T12:01:00Z', '2026-11-08T12:00:00Z', 0), 60_000)
    assert.equal(remainingMs('2026-11-08T12:01:00Z', '2026-11-08T12:00:00Z', 15_250), 44_750)
    assert.equal(remainingMs('2026-11-08T12:01:00Z', '2026-11-08T12:00:00Z', 90_000), 0)
    assert.equal(remainingMs('2026-11-08T12:01:00Z', '2026-11-08T12:00:00Z', -500), 60_000)
    assert.equal(remainingMs(null, '2026-11-08T12:00:00Z', 0), null)
    assert.equal(remainingMs('2026-11-08T12:01:00Z', null, 0), null)
    assert.equal(remainingMs('not a time', '2026-11-08T12:00:00Z', 0), null)
    assert.equal(secondsLeft(44_750), 45)
    assert.equal(secondsLeft(1), 1)
    assert.equal(secondsLeft(0), 0)
    assert.equal(countdownFraction(30_000, 60), 0.5)
    assert.equal(countdownFraction(90_000, 60), 1)
    assert.equal(countdownFraction(-5, 60), 0)
    assert.equal(countdownPhase(10_500), 'running')
    assert.equal(countdownPhase(10_000), 'urgent')
    assert.equal(countdownPhase(1), 'urgent')
    assert.equal(countdownPhase(0), 'expired')
    // Announcements change only with the phase, so screen readers hear two moments, not every tick.
    assert.equal(countdownAnnouncement('running'), '')
    assert.equal(countdownAnnouncement('urgent'), countdownAnnouncement('urgent'))
    assert.match(countdownAnnouncement('urgent'), /10 seconds/)
    assert.equal(countdownAnnouncement('expired'), 'Time is up.')
    assert.equal(countdownLabel(2, 1_000), 'Time left for question 2: 1 second')
    assert.equal(countdownLabel(2, 42_000), 'Time left for question 2: 42 seconds')
})

test('payload clock fields are read, with the 60 second default', () => {
    const value = quiz({ question_seconds: 45, server_time: '2026-11-08T12:00:00Z' })
    assert.equal(value.question_seconds, 45)
    assert.equal(value.server_time, '2026-11-08T12:00:00Z')
    assert.equal(value.questions[2].deadline, '2026-11-08T12:01:00Z')
    assert.equal(quiz({ server_time: 'garbage' }).server_time, null)
    assert.equal(normalizeQuiz({ status: 'ready' })?.question_seconds, 60)
})

test('a timed out question is closed with 0 points and moves the quiz on', () => {
    const value = quiz({ current: 3, questions: [answered(1, 'b', 20), timedOut(2), open(3)], total: 20 })
    assert.equal(value.questions[1].timed_out, true)
    assert.equal(value.questions[1].points, 0)
    assert.equal(currentQuestion(value)?.step, 3)
    assert.equal(closedCount(value), 2)
    assert.equal(previousResult(value)?.step, 2)
    assert.equal(previousResultText(value.questions[1]), 'Question 2: time ran out, 0 of 20')
    assert.equal(previousResultText(value.questions[0]), 'Question 1: you earned 20 of 20')
    assert.equal(earnedText(value.questions[1]), "Time's up: 0 of 20")
    assert.equal(canChoose(value, value.questions[1], false), false)
    assert.deepEqual(quizChips(value).slice(0, 3).map((chip) => [chip.text, chip.status]), [['20 / 20', 'scored'], ['0 / 20', 'scored'], ['- / 20', 'current']])
    // A timed out flag on an answered question is ignored (a pick always wins).
    assert.equal(normalizeQuiz({ status: 'ready', questions: [{ ...answered(1, 'a', 12), timed_out: true }] })?.questions[0].timed_out, false)
    // A timed out current question (the server closed it) is no longer current.
    assert.equal(currentQuestion(quiz({ current: 3, questions: [answered(1, 'b', 20), answered(2, 'a', 12), timedOut(3)] })), null)
    // Ended early: the timed out question is listed with no pick and 0 points.
    const items = reviewQuestions(value)
    assert.equal(items[1].timedOut, true)
    assert.equal(items[1].heading, 'Question 2 · 0 / 20 · time ran out')
    assert.equal(items[1].choices.some((choice) => choice.chosen), false)
    // Released review: no "Your answer" tag, the best choice still marked.
    const review = [{ step: 1, question: 'One?', chosen: null, points: 0, timed_out: true, choices: [
        { choice_id: 'a', text: 'A', points: 8, rationale: 'r' }, { choice_id: 'b', text: 'B', points: 20, rationale: 'r' },
        { choice_id: 'c', text: 'C', points: 0, rationale: 'r' }, { choice_id: 'd', text: 'D', points: 15, rationale: 'r' },
    ] }]
    const released = reviewQuestions(quiz({ review }))[0]
    assert.equal(released.timedOut, true)
    assert.equal(released.points, 0)
    assert.deepEqual(released.choices.map((choice) => choice.tags), [[], ['Best answer'], [], []])
})

test('the demo sends start_at only for the Round 3 shortcut', () => {
    assert.deepEqual(startAtInput('assessment'), { start_at: 'assessment' })
    assert.deepEqual(startAtInput('beginning'), {})
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
    // An open question keeps polling so a server side expiry shows up; a finished quiz does not.
    assert.equal(shouldPollPrivate(session()), true)
    assert.equal(shouldPollPrivate(session({ quiz: { status: 'ready', current: null, questions: [answered(1, 'a', 5)], total: 5 } })), false)
    assert.equal(shouldPollPrivate(session({ quiz: { status: 'generating' } })), true)
    assert.equal(privateStatusText(session()), 'assessment 3/5')
    const fallback = () => 'typed'
    assert.deepEqual(botPrivateStep(session(), new Set(), fallback, 1), { kind: 'choose', key: 'choice:3', step: 3, choiceId: 'a' })
    assert.deepEqual(botPrivateStep(session(), new Set(['choice:3']), fallback), { kind: 'wait' })
    assert.deepEqual(botPrivateStep(session({ quiz: { status: 'generating' }, busy: true }), new Set(), fallback), { kind: 'wait' })
    assert.equal(botPrivateStep(session({ quiz: { status: 'failed' }, retryable: true }), new Set(), fallback).kind, 'retry')
})

test('saved clip answers keep the saved answer label in the transcript', () => {
    const recorded = session({ round: 2, stage: 'coaching', quiz: null, messages: [{ message_id: 'm1', author: 'member', kind: 'answer', round: 2, step: 1, text: 'From the recording', used_clip: true }, { message_id: 'm2', author: 'member', kind: 'answer', round: 2, step: 2, text: 'Typed' }] })
    assert.equal(recorded.messages[0].used_clip, true)
    assert.equal(recorded.messages[1].used_clip, undefined)
    assert.equal(privateEntry(recorded.messages[0], 'Coach', 'Alex').role, 'Saved answer')
    assert.equal(privateEntry(recorded.messages[1], 'Coach', 'Alex').role, 'You')
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

test('quiz outcomes: 0 or a timeout is wrong, 20 is best, between is partial, with matching tags', async () => {
    const { quizOutcome, outcomeTag } = await import('../src/features/game/quizModel.ts')
    const base = { max: 20, chosen: 'a', timed_out: false }
    assert.equal(quizOutcome({ ...base, points: 0 }), 'wrong')
    assert.equal(quizOutcome({ ...base, points: 20 }), 'best')
    assert.equal(quizOutcome({ ...base, points: 12 }), 'partial')
    assert.equal(quizOutcome({ ...base, points: null, chosen: null, timed_out: true }), 'wrong')
    assert.equal(quizOutcome({ ...base, points: null }), null)
    assert.equal(outcomeTag('wrong', 0), 'Wrong answer · 0')
    assert.equal(outcomeTag('partial', 12), 'Partly right · 12')
    assert.equal(outcomeTag('best', 20), 'Best answer · 20')
    assert.equal(outcomeTag(null, null), 'Your answer')
})

test('Round 3 lines are silent: quiz questions and results never queue for voice, test starts skip the prerecorded history', async () => {
    const { withSilentQuiz, nextToSpeak } = await import('../src/features/game/privateSessionModel.ts')
    const line = (id: string, round: number, author = 'agent') => ({ message_id: id, author, kind: 'question', round, step: 1, text: id, status: 'ready', speech_id: id }) as never
    const messages = [line('r2-update', 2), line('r3-transition', 3), line('r3-q1', 3), line('r3-result', 3)]
    const none = new Set<string>()
    assert.equal(nextToSpeak(messages, withSilentQuiz(none, messages, false, false))?.message_id, 'r2-update')
    const quiz = withSilentQuiz(none, messages, true, false)
    assert.equal(nextToSpeak(messages, quiz)?.message_id, 'r2-update', 'the last Round 2 line may still finish')
    assert.equal(nextToSpeak(messages, new Set([...quiz, 'r2-update'])), null, 'nothing in Round 3 is voiced, so the results are not held back')
    assert.equal(nextToSpeak(messages, withSilentQuiz(none, messages, true, true)), null, 'a Round 3 test start voices nothing')
    assert.equal(withSilentQuiz(none, messages, false, false), none)
})
