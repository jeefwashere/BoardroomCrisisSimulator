import test from 'node:test'
import assert from 'node:assert/strict'
import { Blinker, FACE_MORPHS, approach, faceFrame, moodExpression, neutralFace, speechBrow, speechMouth } from '../src/features/boardroom3d/faceExpressions.ts'
import type { FaceContext } from '../src/features/boardroom3d/faceExpressions.ts'
import { boardroomView } from '../src/features/boardroom3d/boardroomModel.ts'

const context = (fields: Partial<FaceContext> = {}): FaceContext => ({ phase: 'speaking', talking: false, memberTalking: false, agentTalking: false, ...fields })

test('the morph names match the face rigged character GLBs', () => {
    assert.deepEqual([...FACE_MORPHS], ['Blink_L', 'Blink_R', 'Smile', 'Frown', 'BrowRaise', 'MouthOpen'])
    assert.deepEqual(Object.keys(neutralFace()).sort(), [...FACE_MORPHS].sort())
})

test('the phase sets the held expression', () => {
    assert.ok(moodExpression(context({ phase: 'ended' })).Smile >= 0.5)
    assert.ok(moodExpression(context({ phase: 'individual_decision' })).Frown >= 0.3)
    assert.ok(moodExpression(context({ phase: 'briefing' })).BrowRaise > 0)
    assert.deepEqual(moodExpression(context({ phase: 'speaking' })), neutralFace())
    // The mouth and eyes are never part of the held expression.
    for (const phase of ['lobby', 'briefing', 'speaking', 'voting', 'ended']) {
        const face = moodExpression(context({ phase, talking: true }))
        assert.equal(face.MouthOpen, 0)
        assert.equal(face.Blink_L + face.Blink_R, 0)
    }
})

test('listeners look attentive and the speaker does not frown while talking', () => {
    assert.ok(moodExpression(context({ memberTalking: true })).BrowRaise > 0)
    assert.ok(moodExpression(context({ agentTalking: true })).BrowRaise >= moodExpression(context({ memberTalking: true })).BrowRaise)
    assert.ok(moodExpression(context({ phase: 'individual_decision', talking: true })).Frown <= 0.1)
})

test('the speech mouth stays in range and actually opens and closes', () => {
    let min = 1, max = 0
    for (let t = 0; t < 20; t += 1 / 60) {
        const open = speechMouth(t, 3.3)
        assert.ok(open >= 0 && open <= 0.6)
        min = Math.min(min, open); max = Math.max(max, open)
        assert.ok(speechBrow(t, 3.3) >= 0 && speechBrow(t, 3.3) <= 0.25)
    }
    assert.ok(min < 0.1, `mouth closes between syllables and phrases (min ${min})`)
    assert.ok(max > 0.4, `mouth opens on syllables (max ${max})`)
    // Different seeds keep characters out of step.
    let difference = 0
    for (let t = 0; t < 5; t += 0.1) difference += Math.abs(speechMouth(t, 1) - speechMouth(t, 50))
    assert.ok(difference > 1)
})

test('blinks close the eyes fully, then reopen, every few seconds', () => {
    const blinker = new Blinker(() => 0.5)
    const dt = 1 / 60
    const values: number[] = []
    for (let t = 0; t < 20; t += dt) values.push(blinker.update(dt))
    const closures = values.filter((v, i) => v === 1 && values[i - 1] !== 1).length
    assert.ok(closures >= 3 && closures <= 8, `about one blink every 2 to 6 seconds (got ${closures} in 20 s)`)
    assert.ok(values.every((v) => v >= 0 && v <= 1))
    assert.ok(values.filter((v) => v > 0).length / values.length < 0.15, 'eyes are open most of the time')
})

test('a frame eases the expression, adds the blink and moves the mouth only while talking', () => {
    const state = neutralFace()
    let frame = faceFrame(state, context({ phase: 'ended' }), 0, 0, 1, 1 / 60)
    assert.ok(frame.Smile > 0 && frame.Smile < 0.55, 'eases toward the smile instead of jumping')
    for (let i = 0; i < 240; i++) frame = faceFrame(state, context({ phase: 'ended' }), 0, i / 60, 1, 1 / 60)
    assert.ok(Math.abs(frame.Smile - 0.55) < 0.01)
    assert.equal(frame.MouthOpen, 0)
    frame = faceFrame(state, context({ phase: 'ended' }), 0.7, 5, 1, 1 / 60)
    assert.equal(frame.Blink_L, 0.7)
    assert.equal(frame.Blink_R, 0.7)
    let opened = 0
    for (let i = 0; i < 300; i++) opened = Math.max(opened, faceFrame(state, context({ talking: true }), 0, i / 60, 1, 1 / 60).MouthOpen)
    assert.ok(opened > 0.3)
    for (let i = 0; i < 120; i++) frame = faceFrame(state, context({ talking: false }), 0, i / 60, 1, 1 / 60)
    assert.ok(frame.MouthOpen < 0.01, 'the mouth closes when speech stops')
    assert.equal(approach(1, 0, 5, 0), 1)
})

test('the board view carries the phase for the faces', () => {
    const seat = { id: 'a', name: 'Alex', role: 'CEO', color: '#123456', connected: true }
    const view = boardroomView({ phase: 'voting', selfId: 'a', eligibleIds: ['a'], activeSpeakerId: null, speakerIndex: null, speakerCount: 0, scenarioTitle: 'T01' }, [seat], new Set(), null)
    assert.equal(view.phase, 'voting')
})
