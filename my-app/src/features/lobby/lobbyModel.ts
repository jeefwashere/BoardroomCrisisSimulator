export const MAX_LOBBY_MEMBERS = 30

// Preview roles. Replace these with the selected scenario's roles when connected.
export const LOBBY_ROLES = [
    { id: 'unassigned', label: 'Choose a role' },
    { id: 'ceo', label: 'CEO' },
    { id: 'finance', label: 'Finance' },
    { id: 'operations', label: 'Operations' },
    { id: 'technology', label: 'Technology' },
    { id: 'communications', label: 'Communications' },
    { id: 'legal', label: 'Legal' },
    { id: 'board-member', label: 'Board member' },
] as const

export type LobbyRole = string

export type LobbyMember = {
    id: string
    name: string
    role: LobbyRole
    isHost: boolean
    roleLabel?: string
    connected?: boolean
    eligibleFromRound?: number | null
    eligibleCurrentRound?: boolean
}

export function addLobbyMember(members: LobbyMember[], member: LobbyMember): LobbyMember[] {
    // An eventual repeated join event must not create another tile or seat.
    if (members.some((existing) => existing.id === member.id)) return members
    if (members.length >= MAX_LOBBY_MEMBERS) throw new Error('The lobby is full. All 30 seats are taken.')
    if (!member.name.trim()) throw new Error('Enter a player name.')
    if (member.isHost && members.some((existing) => existing.isHost)) {
        throw new Error('This lobby already has a host.')
    }

    return [...members, { ...member, name: member.name.trim() }]
}

export function assignLobbyRole(members: LobbyMember[], memberId: string, role: string): LobbyMember[] {
    const selectedRole = LOBBY_ROLES.find((option) => option.id === role)
    if (!selectedRole) throw new Error('Choose a valid role.')
    if (!members.some((member) => member.id === memberId)) throw new Error('That player is no longer in the lobby.')

    return members.map((member) => member.id === memberId ? { ...member, role: selectedRole.id } : member)
}

export function getLobbyRows(members: LobbyMember[]): LobbyMember[][] {
    const rows: LobbyMember[][] = []
    for (let index = 0; index < members.length; index += 2) {
        rows.push(members.slice(index, index + 2))
    }
    return rows
}
