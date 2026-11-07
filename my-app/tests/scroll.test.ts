import test from 'node:test'
import assert from 'node:assert/strict'
import { spring } from 'motion'
import { clampScrollPosition, elasticScrollOffset, reversedScrollRange, wheelDeltaPixels } from '../src/features/lobby/scrollMath.ts'

test('the bottom-anchored list scrolls from zero into a bounded negative range', () => {
    assert.deepEqual(reversedScrollRange(3200, 700), { min: -2500, max: 0 })
    assert.deepEqual(reversedScrollRange(400, 700), { min: 0, max: 0 })
    assert.equal(clampScrollPosition(-800, -2500, 0), -800)
    assert.equal(clampScrollPosition(-3000, -2500, 0), -2500)
    assert.equal(clampScrollPosition(120, -2500, 0), 0)
})

test('wheel deltas preserve direction and normalize pixels, lines, and pages', () => {
    assert.equal(wheelDeltaPixels(-120, 0, 700), -120)
    assert.equal(wheelDeltaPixels(3, 1, 700), 48)
    assert.equal(wheelDeltaPixels(-1, 2, 700), -700)
    assert.equal(wheelDeltaPixels(Number.NaN, 0, 700), 0)
})

test('elastic movement pushes against the scroll boundary and never exceeds 28 pixels', () => {
    assert.equal(elasticScrollOffset(0), 0)
    assert.ok(elasticScrollOffset(120) < 0)
    assert.ok(elasticScrollOffset(-120) > 0)
    assert.ok(Math.abs(elasticScrollOffset(10000)) <= 28)
    assert.ok(Math.abs(elasticScrollOffset(-10000)) <= 28)
    assert.ok(Math.abs(elasticScrollOffset(10)) < Math.abs(elasticScrollOffset(100)))
})

test('the scroll release spring moves, rebounds, and settles at rest', () => {
    const recoil = spring({ keyframes: [0, 0], velocity: -130, stiffness: 240, damping: 17, mass: 0.7 })
    assert.equal(recoil.next(0).value, 0)
    assert.ok(recoil.next(80).value < -1)
    assert.ok(recoil.next(300).value > 0)
    const settled = recoil.next(3000)
    assert.equal(settled.done, true)
    assert.equal(settled.value, 0)
})
