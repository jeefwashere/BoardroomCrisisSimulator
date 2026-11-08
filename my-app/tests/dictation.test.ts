import test from 'node:test'
import assert from 'node:assert/strict'
import { DICTATION_UNAVAILABLE, appendTranscript, dictationErrorNote, readSpeechEvent, speechRecognitionConstructor } from '../src/features/game/dictationModel.ts'
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
