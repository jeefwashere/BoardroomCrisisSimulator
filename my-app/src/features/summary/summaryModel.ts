import type { LobbyMember } from '../lobby/lobbyModel.ts'

export type ParticipantSummary = { memberId: string; text: string }
export type RoomSummaryResponse = {
    roomCode: string
    status: 'pending' | 'ready'
    summaries: ParticipantSummary[]
}

export type SummaryCard = LobbyMember & { summary: string | null }

export type SummaryEmailReceipt = {
    requestId: string
    recipient: string
    mode: 'dummy'
    status: 'preview'
    sent: false
    message: string
}

export function roomSummaryEndpoint(roomCode: string): string {
    return `/api/rooms/${encodeURIComponent(roomCode)}/summary`
}

export function isRoomSummaryResponse(value: unknown): value is RoomSummaryResponse {
    if (typeof value !== 'object' || value === null) return false
    const response = value as Record<string, unknown>
    if (typeof response.roomCode !== 'string' || (response.status !== 'pending' && response.status !== 'ready') || !Array.isArray(response.summaries)) return false
    const seen = new Set<string>()
    return response.summaries.every((item: unknown) => {
        if (typeof item !== 'object' || item === null) return false
        const summary = item as Record<string, unknown>
        if (typeof summary.memberId !== 'string' || !summary.memberId || typeof summary.text !== 'string' || seen.has(summary.memberId)) return false
        seen.add(summary.memberId)
        return true
    })
}

export function buildSummaryCards(members: LobbyMember[], response: RoomSummaryResponse | null): SummaryCard[] {
    const summaries = new Map(response?.summaries.map((summary) => [summary.memberId, summary.text.trim()]) ?? [])
    return members.map((member) => ({ ...member, summary: summaries.get(member.id) || null }))
}

export function summaryEmailError(value: string): string | null {
    const email = value.trim()
    if (!email) return 'Enter an email address.'
    if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email)) return 'Enter a valid email address.'
    return null
}

export function isSummaryEmailReceipt(value: unknown): value is SummaryEmailReceipt {
    if (typeof value !== 'object' || value === null) return false
    const receipt = value as Record<string, unknown>
    return typeof receipt.requestId === 'string'
        && typeof receipt.recipient === 'string'
        && receipt.mode === 'dummy'
        && receipt.status === 'preview'
        && receipt.sent === false
        && typeof receipt.message === 'string'
}
