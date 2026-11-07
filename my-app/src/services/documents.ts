import { DOCUMENT_PROCESSOR_ENDPOINT, isDocumentReceipt, validateLobbyDocument } from '../features/lobby/documentContract.ts'
import type { DocumentReceipt } from '../features/lobby/documentContract.ts'

export async function uploadLobbyDocument(file: File, roomCode: string, signal?: AbortSignal): Promise<DocumentReceipt> {
    const validationError = validateLobbyDocument(file)
    if (validationError) throw new Error(validationError)

    const body = new FormData()
    body.append('document', file)
    body.append('roomCode', roomCode)

    const response = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, {
        method: 'POST',
        body,
        signal,
        credentials: 'same-origin',
    })
    const payload: unknown = await response.json().catch(() => null)

    if (!response.ok) {
        const message = typeof payload === 'object' && payload !== null && 'message' in payload
            ? String(payload.message)
            : 'The document endpoint is unavailable. Please try again.'
        throw new Error(message)
    }
    if (!isDocumentReceipt(payload)) throw new Error('The document endpoint returned an unexpected response.')

    return payload
}
