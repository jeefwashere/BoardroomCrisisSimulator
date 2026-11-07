import test from 'node:test'
import assert from 'node:assert/strict'
import { displayNameError, MAX_NAME_LENGTH, normalizeDisplayName, readSessionName, resolveNameEdit, saveSessionName, SESSION_NAME_KEY } from '../src/features/identity/sessionName.ts'
import type { NameStorage } from '../src/features/identity/sessionName.ts'

function memorySession() {
    const data = new Map<string, string>()
    const storage: NameStorage = {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => { data.set(key, value) },
    }
    return { data, storage }
}

test('names retain their spelling and Unicode while incidental whitespace is normalized', () => {
    assert.equal(normalizeDisplayName('  Zoë   O’Neill  '), 'Zoë O’Neill')
    assert.equal(normalizeDisplayName('  李 明  '), '李 明')
    assert.equal(normalizeDisplayName('Jean\tLuc\nPicard'), 'Jean Luc Picard')
})

test('a name is required and must fit the input length limit', () => {
    assert.match(displayNameError(' \t ')!, /Enter a name/)
    assert.equal(displayNameError('A'.repeat(MAX_NAME_LENGTH)), null)
    assert.match(displayNameError('A'.repeat(MAX_NAME_LENGTH + 1))!, /48 characters/)
})

test('new sessions and invalid stored names require the first visit prompt', () => {
    const { storage, data } = memorySession()
    assert.equal(readSessionName(storage), '')
    data.set(SESSION_NAME_KEY, '   ')
    assert.equal(readSessionName(storage), '')
    data.set(SESSION_NAME_KEY, 'A'.repeat(MAX_NAME_LENGTH + 1))
    assert.equal(readSessionName(storage), '')
})

test('saving stores the normalized name and subsequent page loads can restore it', () => {
    const { storage, data } = memorySession()
    assert.equal(saveSessionName(storage, '  Alex   Morgan '), 'Alex Morgan')
    assert.equal(data.get(SESSION_NAME_KEY), 'Alex Morgan')
    assert.equal(readSessionName(storage), 'Alex Morgan')
    saveSessionName(storage, 'Jordan')
    assert.equal(readSessionName(storage), 'Jordan')
})

test('writing to one session does not write to another session store', () => {
    const first = memorySession()
    const second = memorySession()
    saveSessionName(first.storage, 'Alex')
    assert.equal(readSessionName(second.storage), '')
    saveSessionName(second.storage, 'Jordan')
    assert.equal(readSessionName(first.storage), 'Alex')
    assert.equal(readSessionName(second.storage), 'Jordan')
})

test('invalid saves cannot overwrite the existing session name', () => {
    const { storage } = memorySession()
    saveSessionName(storage, 'Alex')
    assert.throws(() => saveSessionName(storage, '   '), /Enter a name/)
    assert.equal(readSessionName(storage), 'Alex')
})

test('inline confirmation normalizes valid edits and preserves the previous name for invalid edits', () => {
    assert.equal(resolveNameEdit('Alex', '  Jordan  Lee '), 'Jordan Lee')
    assert.equal(resolveNameEdit('Alex', '  '), 'Alex')
    assert.equal(resolveNameEdit('Alex', 'A'.repeat(MAX_NAME_LENGTH + 1)), 'Alex')
})

test('blocked browser storage does not prevent setting a name for the current visit', () => {
    const blocked: NameStorage = {
        getItem: () => { throw new Error('Storage blocked') },
        setItem: () => { throw new Error('Storage blocked') },
    }
    assert.equal(readSessionName(blocked), '')
    assert.equal(saveSessionName(blocked, 'Alex'), 'Alex')
    assert.equal(readSessionName(null), '')
    assert.equal(saveSessionName(null, 'Jordan'), 'Jordan')
})
