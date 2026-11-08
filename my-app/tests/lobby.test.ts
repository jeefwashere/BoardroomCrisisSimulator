import test from 'node:test'
import assert from 'node:assert/strict'
import { addLobbyMember, assignLobbyRole, getLobbyRows, MAX_LOBBY_MEMBERS } from '../src/features/lobby/lobbyModel.ts'
import type { LobbyMember } from '../src/features/lobby/lobbyModel.ts'
import { nextRoleIndex, roleMenuPlacement } from '../src/features/lobby/rolePickerModel.ts'

const host: LobbyMember = { id: 'host', name: 'You', role: 'unassigned', isHost: true }
const guest = (index: number): LobbyMember => ({ id: `guest-${index}`, name: `Player ${index}`, role: 'unassigned', isHost: false })

test('the host counts toward the 30 person capacity and seat 31 is rejected', () => {
    let members = [host]
    for (let index = 1; index < MAX_LOBBY_MEMBERS; index++) members = addLobbyMember(members, guest(index))
    assert.equal(members.length, 30)
    assert.throws(() => addLobbyMember(members, guest(30)), /lobby is full/)
    assert.equal(members.filter((member) => member.isHost).length, 1)
})

test('a repeated join event never creates another seat, even when full', () => {
    const members = [host, ...Array.from({ length: 29 }, (_, index) => guest(index))]
    assert.equal(addLobbyMember(members, guest(2)), members)
    assert.equal(members.length, 30)
})

test('joining preserves existing members and trims the new display name', () => {
    const members = [host]
    const next = addLobbyMember(members, { ...guest(1), name: '  Alex  ' })
    assert.equal(members.length, 1)
    assert.equal(next[0], host)
    assert.equal(next[1].name, 'Alex')
    assert.throws(() => addLobbyMember(members, { ...guest(2), name: '  ' }), /player name/)
    assert.throws(() => addLobbyMember(members, { ...guest(3), isHost: true }), /already has a host/)
})

test('role assignment changes only the selected player and keeps the host indicator independent', () => {
    const members = [host, guest(1)]
    const assigned = assignLobbyRole(members, 'host', 'finance')
    assert.equal(assigned[0].role, 'finance')
    assert.equal(assigned[0].isHost, true)
    assert.equal(assigned[1], members[1])
    assert.equal(members[0].role, 'unassigned')
    assert.equal(assignLobbyRole(assigned, 'host', 'unassigned')[0].role, 'unassigned')
    assert.throws(() => assignLobbyRole(members, 'missing', 'ceo'), /no longer in the lobby/)
    assert.throws(() => assignLobbyRole(members, 'host', 'invented-role'), /valid role/)
})

test('rows fill left to right in stable join order with at most two people', () => {
    assert.deepEqual(getLobbyRows([]), [])
    assert.deepEqual(getLobbyRows([host]), [[host]])
    assert.deepEqual(getLobbyRows([host, guest(1)]), [[host, guest(1)]])
    assert.deepEqual(getLobbyRows([host, guest(1), guest(2)]), [[host, guest(1)], [guest(2)]])

    const members = [host, ...Array.from({ length: 29 }, (_, index) => guest(index))]
    const rows = getLobbyRows(members)
    assert.equal(rows.length, 15)
    assert.ok(rows.every((row) => row.length <= 2))
    assert.deepEqual(rows.flat(), members)
})

test('borderless role choices support arrow navigation, wraparound, Home, and End', () => {
    assert.equal(nextRoleIndex(0, 'ArrowUp', 8), 7)
    assert.equal(nextRoleIndex(7, 'ArrowDown', 8), 0)
    assert.equal(nextRoleIndex(3, 'ArrowDown', 8), 4)
    assert.equal(nextRoleIndex(3, 'Home', 8), 0)
    assert.equal(nextRoleIndex(3, 'End', 8), 7)
    assert.equal(nextRoleIndex(3, 'Escape', 8), 3)
    assert.equal(nextRoleIndex(0, 'ArrowDown', 0), -1)
})

test('role choices open below the player when enough screen space is available', () => {
    const placement = roleMenuPlacement({ left: 200, top: 100, bottom: 144, width: 180 }, { width: 1000, height: 800 }, 280)
    assert.ok(placement.top > 144)
    assert.equal(placement.width, 180)
    assert.equal(placement.height, 280)
})

test('role choices near the bottom open above instead of being clipped by the player list', () => {
    const placement = roleMenuPlacement({ left: 200, top: 650, bottom: 694, width: 180 }, { width: 1000, height: 720 }, 280)
    assert.ok(placement.top + placement.height < 650)
    assert.ok(placement.top >= 12)
})

test('role choices stay inside narrow screens at either horizontal edge', () => {
    for (const left of [-20, 240]) {
        const placement = roleMenuPlacement({ left, top: 250, bottom: 294, width: 150 }, { width: 320, height: 480 }, 300)
        assert.ok(placement.left >= 12)
        assert.ok(placement.left + placement.width <= 308)
        assert.ok(placement.top >= 12)
        assert.ok(placement.top + placement.height <= 468)
    }
})
