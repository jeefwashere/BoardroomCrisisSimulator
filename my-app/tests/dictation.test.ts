import test from 'node:test'
import assert from 'node:assert/strict'
import { DICTATION_UNAVAILABLE, appendTranscript, createSpeechReader, dictationErrorNote, readSpeechEvent, speechRecognitionConstructor, unseenFinal } from '../src/features/game/dictationModel.ts'
import type { SpeechResultLike } from '../src/features/game/dictationModel.ts'

function result(transcript: string, isFinal: boolean): SpeechResultLike {
    return Object.assign([{ transcript }], { isFinal })
}

test('dictated words append to typed text with one space', () => {
    assert.equal(appendTranscript('', ' I would  verify '), 'I would verify')
    assert.equal(appendTranscript('I would', 'verify backups'), 'I would verify backups')
    assert.equal(appendTranscript('I would ', 'verify'), 'I would verify')
    assert.equal(appendTranscript('Line one\n', 'line two'), 'Line one\nline two')
    assert.equal(appendTranscript('Typed', '   '), 'Typed')
})

test('a recognition event yields only new final words plus the current interim words', () => {
    const results = [result('already delivered', true), result(' because backups', true), result(' are not', false), result(' tested', false)]
    assert.deepEqual(readSpeechEvent({ resultIndex: 1, results }), { final: 'because backups', interim: 'are not tested' })
    assert.deepEqual(readSpeechEvent({ resultIndex: 0, results: [result('hello', false)] }), { final: '', interim: 'hello' })
    assert.deepEqual(readSpeechEvent({ resultIndex: 2, results: [result('a', true)] }), { final: '', interim: '' })
})

test('the recognizer is found under either name, or reported as unsupported', () => {
    class Recognizer {}
    assert.equal(speechRecognitionConstructor({ SpeechRecognition: Recognizer }), Recognizer)
    assert.equal(speechRecognitionConstructor({ webkitSpeechRecognition: Recognizer }), Recognizer)
    assert.equal(speechRecognitionConstructor({}), null)
    assert.equal(speechRecognitionConstructor(undefined), null)
})

test('a refused microphone becomes the type instead note; silence and stop are quiet', () => {
    assert.equal(dictationErrorNote('not-allowed'), DICTATION_UNAVAILABLE)
    assert.equal(dictationErrorNote('service-not-allowed'), DICTATION_UNAVAILABLE)
    assert.equal(dictationErrorNote('no-speech'), null)
    assert.equal(dictationErrorNote('aborted'), null)
    assert.match(dictationErrorNote('network') ?? '', /type instead/)
    assert.equal(DICTATION_UNAVAILABLE, "Voice input isn't available in this browser; type instead.")
})

/** Feeds events to one session reader and appends the final words the way the decision textarea does. */
function dictate(events: { resultIndex: number; results: SpeechResultLike[] }[], typed = ''): string {
    const read = createSpeechReader()
    return events.reduce((text, event) => appendTranscript(text, read(event).final), typed)
}

const FIRST = 'nobody has tested whether the backups actually restore so IT will not promise a restoration time until they have proved one backup restores'
const REVISED = 'Nobody has tested whether the backups actually restore. So IT will not promise a restoration time until they have proved one backup restores cleanly.'

test('reported bug: a revised final that repeats the previous final no longer duplicates the decision text', () => {
    const events = [
        { resultIndex: 0, results: [result(FIRST, true)] },
        { resultIndex: 1, results: [result(FIRST, true), result(REVISED, true)] },
    ]
    // The old stateless reader appends both finals: "...proved one backup restores Nobody has tested ... restores cleanly."
    const naive = events.reduce((text, event) => appendTranscript(text, readSpeechEvent(event).final), '')
    assert.match(naive, /proved one backup restores Nobody has tested/)
    assert.equal(dictate(events), `${FIRST} cleanly.`)
})

test('a final result re-sent with an older resultIndex is not appended again', () => {
    const events = [
        { resultIndex: 0, results: [result('I would appoint a coordinator', true)] },
        { resultIndex: 0, results: [result('I would appoint a coordinator', true), result('and verify backups', true)] },
        { resultIndex: 0, results: [result('I would appoint a coordinator', true), result('and verify backups', true), result('first', false)] },
    ]
    assert.equal(dictate(events), 'I would appoint a coordinator and verify backups')
})

test('Android style cumulative and duplicate finals add only their new words', () => {
    const cumulative = [
        { resultIndex: 0, results: [result('verify the backups', true)] },
        { resultIndex: 0, results: [result('verify the backups before we promise', true)] },
        { resultIndex: 1, results: [result('verify the backups before we promise', true), result('verify the backups before we promise a time', true)] },
    ]
    assert.equal(dictate(cumulative), 'verify the backups before we promise a time')
    const duplicate = [
        { resultIndex: 0, results: [result('call the vendor', true)] },
        { resultIndex: 1, results: [result('call the vendor', true), result('call the vendor', true)] },
    ]
    assert.equal(dictate(duplicate, 'Typed first.'), 'Typed first. call the vendor')
})

test('ordinary continuous dictation keeps every new phrase, including real repeats later on', () => {
    const events = [
        { resultIndex: 0, results: [result('restore one backup', false)] },
        { resultIndex: 0, results: [result('restore one backup', true)] },
        { resultIndex: 1, results: [result('restore one backup', true), result('then tell the board', true)] },
        { resultIndex: 2, results: [result('restore one backup', true), result('then tell the board', true), result('restore one backup', true)] },
    ]
    assert.equal(dictate(events), 'restore one backup then tell the board restore one backup')
})

test('unseenFinal compares words without case or punctuation', () => {
    assert.equal(unseenFinal('Restore. Then report', ['restore']), 'Then report')
    assert.equal(unseenFinal('restore', ['Restore, then report']), '')
    assert.equal(unseenFinal('brand new words', ['something else']), 'brand new words')
    assert.equal(unseenFinal('  ', ['x']), '')
})
