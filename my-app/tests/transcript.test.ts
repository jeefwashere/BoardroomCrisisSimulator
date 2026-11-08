import test from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_TRANSCRIPT_ENTRIES, assessmentDividerEntry, briefingEntry, captionsPreference, estimateSpeechMs, expertEntry, privateAutoEntry, privateEntry,
    privateTranscriptLines, revealedLength, revealedText, silentHoldMs, speechDurationMs, transcriptReducer, turnEntry,
} from '../src/features/game/transcriptModel.ts'
import type { TranscriptEntry, TranscriptInput } from '../src/features/game/transcriptModel.ts'
import type { PrivateMessage } from '../src/services/facilitation.ts'

const line = (id: string, text = `Text ${id}`): TranscriptInput => ({ id, speaker: 'Morgan', role: 'Recovery', tone: 'member', text })

test('upsert appends a full line once and leaves unchanged input alone', () => {
    const one = transcriptReducer([], { type: 'upsert', entry: line('a') })
    assert.deepEqual(one, [{ ...line('a'), live: false, reveal: null }])
    assert.equal(transcriptReducer(one, { type: 'upsert', entry: line('a') }), one)
    const edited = transcriptReducer(one, { type: 'upsert', entry: line('a', 'Changed') })
    assert.equal(edited[0].text, 'Changed')
    assert.equal(edited.length, 1)
})

test('speak reveals in time with the audio, keeps one live line, and done shows the whole text', () => {
    let state = transcriptReducer([], { type: 'speak', entry: line('a'), at: 1000, durationMs: 4000 })
    assert.deepEqual(state[0].reveal, { startedAt: 1000, durationMs: 4000 })
    assert.equal(state[0].live, true)
    state = transcriptReducer(state, { type: 'speak', entry: line('b'), at: 6000, durationMs: null })
    assert.equal(state[0].live, false, 'the earlier speaker stops being live')
    assert.equal(state[0].reveal, null)
    assert.equal(state[1].live, true)
    assert.equal(state[1].reveal, null, 'no audio length shows the full text at once')
    const done = transcriptReducer(state, { type: 'done', id: 'b' })
    assert.equal(done[1].live, false)
    assert.equal(transcriptReducer(done, { type: 'done', id: 'b' }), done, 'ending twice changes nothing')
    assert.equal(transcriptReducer(done, { type: 'done', id: 'missing' }), done)
})

test('speaking an existing line keeps its position and upsert keeps its live reveal', () => {
    let state = transcriptReducer([], { type: 'upsert', entry: line('a') })
    state = transcriptReducer(state, { type: 'upsert', entry: line('b') })
    state = transcriptReducer(state, { type: 'speak', entry: line('a'), at: 0, durationMs: 1000 })
    assert.deepEqual(state.map((entry) => entry.id), ['a', 'b'])
    const same = transcriptReducer(state, { type: 'upsert', entry: line('a') })
    assert.equal(same, state)
    assert.equal(same[0].live, true)
})

test('the transcript drops the oldest lines beyond its cap and clear empties it', () => {
    let state: TranscriptEntry[] = []
    for (let index = 0; index < MAX_TRANSCRIPT_ENTRIES + 5; index++) state = transcriptReducer(state, { type: 'upsert', entry: line(String(index)) })
    assert.equal(state.length, MAX_TRANSCRIPT_ENTRIES)
    assert.equal(state[0].id, '5')
    assert.deepEqual(transcriptReducer(state, { type: 'clear' }), [])
})

test('reveal timing follows the audio and never cuts a word in half', () => {
    const text = 'Appoint an interim coordinator now'
    const reveal = { startedAt: 1000, durationMs: 1000 }
    assert.equal(revealedLength(text, reveal, 500), 0)
    assert.equal(revealedLength(text, reveal, 1500), Math.ceil(text.length / 2))
    assert.equal(revealedLength(text, reveal, 2500), text.length)
    assert.equal(revealedLength(text, null, 0), text.length)
    assert.equal(revealedText(text, reveal, 1000 + 1000 * (8.5 / text.length)), 'Appoint')
    assert.equal(revealedText(text, reveal, 1000 + 1000 * (6.5 / text.length)), 'Appoint', 'a boundary at a space keeps the word')
    assert.equal(revealedText(text, reveal, 1000 + 1000 * (2.5 / text.length)), '', 'the first partial word stays hidden')
    assert.equal(revealedText(text, reveal, 3000), text)
})

test('durations come from the audio when known, otherwise from the speaking pace', () => {
    assert.equal(speechDurationMs(14.211, 'x'), 14211)
    assert.equal(speechDurationMs(null, 'a'.repeat(30)), 2000)
    assert.equal(speechDurationMs(Number.NaN, 'a'.repeat(15)), 1000)
    assert.equal(estimateSpeechMs('a'.repeat(32), 16), 2000)
    assert.equal(silentHoldMs('a'.repeat(30), 15, 1600), 3600)
    assert.equal(silentHoldMs('a'.repeat(300), 16, 900, 4000), 4000)
})

test('captions are on unless this tab stored an explicit off', () => {
    assert.equal(captionsPreference(null), true)
    assert.equal(captionsPreference('1'), true)
    assert.equal(captionsPreference('0'), false)
})

test('entry builders give stable IDs, speakers and role tags', () => {
    assert.deepEqual(briefingEntry({ speech_id: 's1', text: 'Welcome.' }), { id: 'opening:s1', speaker: 'Preparation agent', role: 'AI agent', tone: 'agent', text: 'Welcome.' })
    assert.deepEqual(expertEntry('r1', { kind: 'security', label: 'IT and security', text: 'Preserve logs.' }, '#123456'),
        { id: 'expert:r1:security', speaker: 'IT and security', role: 'Expert', tone: 'expert', text: 'Preserve logs.', accent: '#123456' })
    assert.equal(expertEntry('r1', { kind: 'security', label: 'IT', text: '' }).accent, undefined)
    assert.deepEqual(turnEntry('p1:a', { name: 'Alex', role: 'CEO' }, 'Hello', true), { id: 'turn:p1:a', speaker: 'Alex (you)', role: 'CEO', tone: 'self', text: 'Hello' })
    assert.equal(turnEntry('p2:m', { name: 'Morgan', role: 'Recovery' }, 'Hi', false).speaker, 'Morgan')
    assert.equal(privateAutoEntry('2:1:clip', 'Alex', 'Saved').id, 'private-auto:2:1:clip')
    assert.equal(assessmentDividerEntry('Coach').tone, 'system')
})

function message(id: string, fields: Partial<PrivateMessage> = {}): PrivateMessage {
    return { message_id: id, author: 'agent', kind: 'question', round: 2, step: 1, text: `Line ${id}`, status: 'ready', source: 'vertex', speech_id: `sp-${id}`, at: '', ...fields }
}

test('private messages map to coach, examiner, answer and note lines', () => {
    assert.deepEqual(privateEntry(message('1'), 'Coach', 'Alex'), { id: 'private:1', speaker: 'Coach', role: 'Crisis coach', tone: 'coach', text: 'Line 1' })
    assert.equal(privateEntry(message('2', { round: 3 }), 'Coach', 'Alex').speaker, 'Coach · examiner')
    assert.equal(privateEntry(message('3', { author: 'member', kind: 'answer' }), 'Coach', 'Alex').speaker, 'Alex (you)')
    assert.equal(privateEntry(message('4', { status: 'failed', text: '' }), 'Coach', 'Alex').text, 'This reply could not be prepared.')
})

test('private transcript lines skip the voiced line, pending replies and already captioned answers, and mark the hand over', () => {
    const messages = [
        message('q1'), message('a1', { author: 'member', kind: 'answer', text: 'Saved clip words' }), message('t', { kind: 'transition', round: 3 }),
        message('q2', { round: 3 }), message('p', { status: 'pending', round: 3 }), message('later', { round: 3 }),
    ]
    const lines = privateTranscriptLines(messages, 4, 'q2', 'Coach', 'Alex', new Set(['Saved clip words']))
    assert.deepEqual(lines.map((item) => item.id), ['private:q1', 'private:round3-divider', 'private:t'])
    const all = privateTranscriptLines(messages, messages.length, null, 'Coach', 'Alex')
    assert.deepEqual(all.map((item) => item.id), ['private:q1', 'private:a1', 'private:round3-divider', 'private:t', 'private:q2', 'private:later'])
})
