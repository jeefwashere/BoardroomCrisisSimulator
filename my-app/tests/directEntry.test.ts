import test from 'node:test'
import assert from 'node:assert/strict'
import { deferLinkedJoin, linkedJoinKey } from '../src/features/rooms/directEntry.ts'

test('only a valid join link and known name permit direct admission', () => {
    assert.equal(linkedJoinKey('join', ' ab12cd ', 'Known Name'), '["AB12CD","Known Name"]')
    for (const code of ['', '12345', '1234567', 'a!b123']) assert.equal(linkedJoinKey('join', code, 'Known'), null)
    assert.equal(linkedJoinKey('join', 'AB12CD', ''), null)
    assert.equal(linkedJoinKey('join', 'AB12CD', '  '), null)
    assert.equal(linkedJoinKey('host', 'AB12CD', 'Known'), null)
})

test('StrictMode setup cleanup setup dispatches exactly once, with no automatic retry', async () => {
    let calls = 0
    const attempted = new Set<string>()
    const key = linkedJoinKey('join', 'ABC123', 'Guest')
    const firstCleanup = deferLinkedJoin(key, attempted, () => calls++)
    firstCleanup()
    const cleanup = deferLinkedJoin(key, attempted, () => calls++)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(calls, 1)
    cleanup()
    deferLinkedJoin(key, attempted, () => calls++)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(calls, 1)
})

test('the name prompt can resolve before the first automatic attempt and disposal cancels it', async () => {
    const attempted = new Set<string>()
    let calls = 0
    deferLinkedJoin(linkedJoinKey('join', 'ABC123', ''), attempted, () => calls++)
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(calls, 0)
    const cleanup = deferLinkedJoin(linkedJoinKey('join', 'ABC123', 'New Name'), attempted, () => calls++)
    cleanup()
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(calls, 0)
    assert.equal(attempted.size, 0)
})
