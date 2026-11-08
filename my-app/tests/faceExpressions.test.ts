import test from 'node:test'
import assert from 'node:assert/strict'
import {
    Blinker, FACE_MORPHS, REACTION_SECONDS, SPEECH_BROW_MAX, SPEECH_MOUTH_MAX, SPEECH_MOUTH_PARTED, approach, emitFaceReaction, faceFrame, moodExpression, neutralFace,
    onFaceReaction, reactionStrength, speechBrow, speechMouth,
} from '../src/features/boardroom3d/faceExpressions.ts'
import type { FaceReaction } from '../src/features/boardroom3d/faceExpressions.ts'
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
    assert.ok(moodExpression(context({ phase: 'individual_decision', talking: true })).Frown <= 0.12)
})

test('a speaker shows a warm, moderate expression in every phase', () => {
    for (const phase of ['lobby', 'briefing', 'speaking', 'individual_decision', 'private_session', 'voting', 'ended']) {
        const face = moodExpression(context({ phase, talking: true }))
        assert.ok(face.Smile >= 0.15 && face.Smile <= 0.3, `${phase} smile ${face.Smile}`)
        assert.ok(face.Frown <= 0.12 && face.BrowRaise >= 0.08, phase)
    }
})

test('the speaking face keeps moving: smile and brows vary while talking', () => {
    const state = neutralFace()
    let smileMin = 1, smileMax = 0, browMax = 0
    for (let i = 0; i < 600; i++) {
        const frame = faceFrame(state, context({ talking: true }), 0, i / 60, 2, 1 / 60)
        if (i > 120) { smileMin = Math.min(smileMin, frame.Smile); smileMax = Math.max(smileMax, frame.Smile) }
        browMax = Math.max(browMax, frame.BrowRaise)
    }
    assert.ok(smileMax - smileMin > 0.1, `smile varies (${smileMin} to ${smileMax})`)
    assert.ok(smileMax <= 0.35, 'never a grin while speaking')
    assert.ok(browMax > 0.15, `brows lift (${browMax})`)
})

test('the speech mouth opens moderately, never wide, and opens and closes', () => {
    assert.ok(SPEECH_MOUTH_MAX <= 0.45, 'never a wide open mouth')
    let min = 1, max = 0
    for (let t = 0; t < 20; t += 1 / 60) {
        const open = speechMouth(t, 3.3)
        assert.ok(open >= 0 && open <= SPEECH_MOUTH_MAX)
        min = Math.min(min, open); max = Math.max(max, open)
        assert.ok(speechBrow(t, 3.3) >= 0 && speechBrow(t, 3.3) <= SPEECH_BROW_MAX)
    }
    assert.ok(min < 0.03, `mouth closes in the pauses between phrases (min ${min})`)
    assert.ok(max > 0.35, `the mouth visibly opens on syllables (max ${max})`)
    // Mid phrase the lips stay parted: most of the time the mouth is visibly open.
    let parted = 0, samples = 0
    for (let t = 0; t < 20; t += 1 / 60, samples++) if (speechMouth(t, 3.3) >= SPEECH_MOUTH_PARTED * 0.9) parted++
    assert.ok(parted / samples > 0.7, `lips parted ${Math.round(100 * parted / samples)}% of the time`)
    // Different seeds keep characters out of step.
    let difference = 0
    for (let t = 0; t < 5; t += 0.1) difference += Math.abs(speechMouth(t, 1) - speechMouth(t, 50))
    assert.ok(difference > 0.4)
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
    assert.ok(opened > 0.2 && opened <= SPEECH_MOUTH_MAX)
    for (let i = 0; i < 120; i++) frame = faceFrame(state, context({ talking: false }), 0, i / 60, 1, 1 / 60)
    assert.ok(frame.MouthOpen < 0.01, 'the mouth closes when speech stops')
    assert.equal(approach(1, 0, 5, 0), 1)
})

test('the board view carries the phase for the faces', () => {
    const seat = { id: 'a', name: 'Alex', role: 'CEO', color: '#123456', connected: true }
    const view = boardroomView({ phase: 'voting', selfId: 'a', eligibleIds: ['a'], activeSpeakerId: null, speakerIndex: null, speakerCount: 0, scenarioTitle: 'T01' }, [seat], new Set(), null)
    assert.equal(view.phase, 'voting')
})

test('a wrong answer brings a frown and the best answer a smile, then the face returns to normal', () => {
    const frameAt = (reaction: FaceReaction, age: number) => {
        const state = neutralFace()
        return faceFrame(state, context({ phase: 'private_session' }), 0, 0, 1, 1 / 60, { reaction, age })
    }
    const wrong = frameAt('wrong', 1)
    assert.ok(wrong.Frown >= 0.8 && wrong.Smile === 0, `frown (${wrong.Frown})`)
    const best = frameAt('best', 1)
    assert.ok(best.Smile >= 0.8 && best.Frown === 0, `smile (${best.Smile})`)
    const partial = frameAt('partial', 1)
    assert.ok(partial.Smile > 0 && partial.Smile < best.Smile)
    // It builds and fades rather than snapping, and is gone after REACTION_SECONDS.
    assert.ok(reactionStrength(0.05) > 0 && reactionStrength(0.05) < 1)
    assert.equal(reactionStrength(1.5), 1)
    assert.ok(reactionStrength(REACTION_SECONDS - 0.2) < 1)
    assert.equal(reactionStrength(REACTION_SECONDS), 0)
    assert.deepEqual(frameAt('wrong', REACTION_SECONDS), faceFrame(neutralFace(), context({ phase: 'private_session' }), 0, 0, 1, 1 / 60))
    // The reaction never opens the mouth or closes the eyes.
    assert.equal(best.MouthOpen, 0)
    assert.equal(wrong.Blink_L, 0)
})

test('answer results reach the scene through the reaction channel', () => {
    const heard: FaceReaction[] = []
    const stop = onFaceReaction((reaction) => heard.push(reaction))
    emitFaceReaction('wrong')
    emitFaceReaction('best')
    stop()
    emitFaceReaction('partial')
    assert.deepEqual(heard, ['wrong', 'best'])
})
