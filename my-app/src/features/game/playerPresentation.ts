import { LOBBY_ROLES } from '../lobby/lobbyModel.ts'
import type { LobbyRole } from '../lobby/lobbyModel.ts'

const avatarColors = ['#8b5a3c', '#397474', '#956244', '#8f4e69', '#466d92', '#765ba0']

export function playerInitials(name: string): string {
    return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase() || '?'
}

export function playerRoleLabel(role: LobbyRole): string {
    return role === 'unassigned' ? 'Unassigned' : LOBBY_ROLES.find((option) => option.id === role)?.label ?? role.replaceAll('_', ' ')
}

export function playerAvatarColor(memberId: string): string {
    let hash = 0
    for (const character of memberId) hash = Math.imul(hash, 31) + character.charCodeAt(0) | 0
    return avatarColors[(hash >>> 0) % avatarColors.length]
}
