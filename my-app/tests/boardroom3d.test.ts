import test from 'node:test'
import assert from 'node:assert/strict'
import { BOARD_SEATS, boardMembers, boardroomView, screenSubtitle, viewFromSearch } from '../src/features/boardroom3d/boardroomModel.ts'
import type { BoardMember, BoardroomInput, StageAgent } from '../src/features/boardroom3d/boardroomModel.ts'
import { readDemoView, soloFrameSrc } from '../src/features/demo/demoModel.ts'

const member = (id: string, name: string): BoardMember => ({ id, name, role: `${name} role`, color: '#123456', connected: true })
const alex = member('a', 'Alex')
const morgan = member('m', 'Morgan')
const sam = member('s', 'Sam')
const input = (fields: Partial<BoardroomInput> = {}): BoardroomInput => ({
    phase: 'speaking', selfId: 'a', eligibleIds: ['a', 'm', 's'], activeSpeakerId: null, speakerIndex: null, speakerCount: 9, scenarioTitle: 'Cedar Bridge', ...fields,
})
const coach: StageAgent = { kind: 'coach', name: 'Crisis coach', role: 'AI crisis coach · private', accent: null }

test('seats follow the electorate order and stop at three', () => {
    const extra = member('x', 'Extra')
    assert.equal(BOARD_SEATS, 3)
    assert.deepEqual(boardMembers([sam, extra, morgan, alex], ['a', 'm', 's']).map((seat) => seat.id), ['a', 'm', 's'])
    assert.deepEqual(boardMembers([extra, morgan], ['a', 'm']).map((seat) => seat.id), ['m', 'x'])
})

test('the talking member animates and the camera presents them', () => {
    const view = boardroomView(input({ activeSpeakerId: 'm', speakerIndex: 1 }), [alex, morgan, sam], new Set(['m']), null)
    assert.equal(view.focusId, 'm')
    assert.deepEqual(view.seats.map((seat) => seat.mood), ['sit', 'talk', 'sit'])
    assert.equal(view.seats[0].isSelf, true)
    assert.equal(view.screen.subtitle, 'Turn 2 of 9')
    assert.equal(view.agentPresent, false)
})

test('your own turn keeps the camera on you before your clip plays', () => {
    const view = boardroomView(input({ activeSpeakerId: 'a', speakerIndex: 0 }), [alex, morgan, sam], new Set(), null)
    assert.equal(view.focusId, 'a')
    assert.equal(view.seats[0].mood, 'sit')
})

test('an agent speaking takes the camera to the hub', () => {
    const view = boardroomView(input({ phase: 'private_session' }), [alex, morgan, sam], new Set(), coach)
    assert.equal(view.focusId, null)
    assert.equal(view.agent, coach)
    assert.equal(view.agentPresent, true)
    // The others work through their own private sessions.
    assert.deepEqual(view.seats.map((seat) => seat.mood), ['sit', 'typing', 'typing'])
})

test('agent phases keep the hub present between lines; decisions make everyone type', () => {
    assert.equal(boardroomView(input({ phase: 'briefing' }), [alex], new Set(), null).agentPresent, true)
    assert.equal(boardroomView(input({ phase: 'discussion' }), [alex], new Set(), null).agentPresent, true)
    const deciding = boardroomView(input({ phase: 'individual_decision' }), [alex, morgan, sam], new Set(), null)
    assert.equal(deciding.agentPresent, false)
    assert.deepEqual(deciding.seats.map((seat) => seat.mood), ['typing', 'typing', 'typing'])
    assert.equal(deciding.focusId, null)
})

test('wall screen subtitles name the phase without any spoken text', () => {
    assert.equal(screenSubtitle({ phase: 'speaking', speakerIndex: null, speakerCount: 9 }), 'Speaking turns')
    assert.equal(screenSubtitle({ phase: 'discussion', speakerIndex: null, speakerCount: 0 }), 'Expert panel')
    assert.equal(screenSubtitle({ phase: 'some_new_phase', speakerIndex: null, speakerCount: 0 }), 'some new phase')
})

test('view and demo stage choices', () => {
    assert.equal(viewFromSearch('?seat=alex&view=3d'), '3d')
    assert.equal(viewFromSearch('?view=call'), 'call')
    assert.equal(viewFromSearch('?view=vr'), null)
    assert.equal(readDemoView(null), '3d')
    assert.equal(readDemoView('call'), 'call')
    const id = '123e4567-e89b-12d3-a456-426614174000'
    assert.equal(soloFrameSrc('/', id, '3d'), `/?seat=alex&view=3d#/room/${id}`)
    assert.equal(soloFrameSrc('/', id, 'call'), `/?seat=alex#/room/${id}`)
})
