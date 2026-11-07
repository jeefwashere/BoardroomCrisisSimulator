import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCallLayout, CALL_GRID_GAP } from '../src/features/game/callLayout.ts'
import { playerAvatarColor, playerInitials, playerRoleLabel } from '../src/features/game/playerPresentation.ts'
import { assignLobbyRole } from '../src/features/lobby/lobbyModel.ts'
import type { LobbyMember } from '../src/features/lobby/lobbyModel.ts'

test('an empty call does not produce invalid tile dimensions', () => {
    assert.deepEqual(calculateCallLayout(0, 1280, 720), { columns: 0, rows: 0, tileWidth: 0, tileHeight: 0, needsScroll: false })
})

test('a single player gets one large tile contained inside the call viewport', () => {
    const layout = calculateCallLayout(1, 1280, 720)
    assert.equal(layout.columns, 1)
    assert.equal(layout.rows, 1)
    assert.equal(layout.needsScroll, false)
    assert.ok(layout.tileWidth > 800 && layout.tileWidth <= 1280)
    assert.ok(layout.tileHeight <= 720)
})

test('all 1 to 30 player layouts fit a desktop screen without hiding players', () => {
    for (let count = 1; count <= 30; count++) {
        const layout = calculateCallLayout(count, 1280, 720)
        assert.equal(layout.needsScroll, false, `${count} players should fit`)
        assert.equal(layout.rows, Math.ceil(count / layout.columns))
        assert.ok(layout.columns >= 1 && layout.columns <= 6)
        assert.ok(layout.tileWidth >= 144)
        assert.ok(layout.columns * layout.tileWidth + (layout.columns - 1) * CALL_GRID_GAP <= 1280)
        assert.ok(layout.rows * layout.tileHeight + (layout.rows - 1) * CALL_GRID_GAP <= 720)
        assert.ok(layout.rows * layout.columns >= count)
    }
})

test('small viewports use scrolling instead of making 30 player labels unreadable', () => {
    const mobile = calculateCallLayout(30, 320, 500)
    assert.equal(mobile.needsScroll, true)
    assert.equal(mobile.columns, 2)
    assert.equal(mobile.rows, 15)
    assert.ok(mobile.tileWidth >= 144)
    assert.ok(mobile.rows * mobile.tileHeight + (mobile.rows - 1) * CALL_GRID_GAP > 500)
    const unmeasured = calculateCallLayout(30, 0, 0)
    assert.ok(Number.isFinite(unmeasured.tileWidth) && unmeasured.tileWidth > 0)
    assert.ok(Number.isFinite(unmeasured.tileHeight) && unmeasured.tileHeight > 0)
})

test('call avatars preserve player initials, including Unicode names', () => {
    assert.equal(playerInitials('  Ada   Lovelace '), 'AL')
    assert.equal(playerInitials('Zoë'), 'Z')
    assert.equal(playerInitials('李 明'), '李明')
    assert.equal(playerInitials(''), '?')
})

test('game role labels reflect lobby assignments without showing form instructions', () => {
    const members: LobbyMember[] = [
        { id: 'host', name: 'Alex', role: 'unassigned', isHost: true },
        { id: 'guest', name: 'Jordan', role: 'unassigned', isHost: false },
    ]
    const assigned = assignLobbyRole(members, 'guest', 'finance')
    assert.equal(assigned[1].name, 'Jordan')
    assert.equal(playerRoleLabel(assigned[1].role), 'Finance')
    assert.equal(playerRoleLabel(assigned[0].role), 'Unassigned')
    assert.equal(assigned[0].isHost, true)
})

test('avatar colors remain stable when a player changes their display name or role', () => {
    assert.equal(playerAvatarColor('stable-member-id'), playerAvatarColor('stable-member-id'))
    assert.match(playerAvatarColor('stable-member-id'), /^#[0-9a-f]{6}$/i)
    assert.match(playerAvatarColor(''), /^#[0-9a-f]{6}$/i)
})
