import { isRoomSummaryResponse, isSummaryEmailReceipt, roomSummaryEndpoint, summaryEmailError } from '../features/summary/summaryModel.ts'
import type { RoomSummaryResponse, SummaryEmailReceipt } from '../features/summary/summaryModel.ts'

async function responsePayload(response: Response): Promise<unknown> {
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
        const message = typeof payload === 'object' && payload !== null && 'message' in payload
            ? String(payload.message)
            : 'The summary service is unavailable. Please try again.'
        throw new Error(message)
    }
    return payload
}

// Planned frontend contracts. Replace the dev/preview stubs with the authenticated backend.
export async function fetchRoomSummary(roomCode: string, signal?: AbortSignal): Promise<RoomSummaryResponse> {
    const response = await fetch(roomSummaryEndpoint(roomCode), {
        signal,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
    })
    const payload = await responsePayload(response)
    if (!isRoomSummaryResponse(payload) || payload.roomCode !== roomCode) throw new Error('The summary service returned an unexpected response.')
    return payload
}

export async function requestSummaryEmail(roomCode: string, email: string, signal?: AbortSignal): Promise<SummaryEmailReceipt> {
    const error = summaryEmailError(email)
    if (error) throw new Error(error)
    const recipient = email.trim()
    const response = await fetch(`${roomSummaryEndpoint(roomCode)}/email`, {
        method: 'POST',
        signal,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: recipient }),
    })
    const payload = await responsePayload(response)
    if (!isSummaryEmailReceipt(payload) || payload.recipient !== recipient) throw new Error('The email service returned an unexpected response.')
    return payload
}
