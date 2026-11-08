import { DOCUMENT_PROCESSOR_ENDPOINT, isDocumentReceipt, validateLobbyDocuments } from '../features/lobby/documentContract.ts'
import type { DocumentReceipt } from '../features/lobby/documentContract.ts'

export async function uploadLobbyDocument(file: File, roomCode: string, signal?: AbortSignal): Promise<DocumentReceipt> {
    return (await uploadLobbyDocuments([file], roomCode, signal))[0]
}

export async function uploadLobbyDocuments(files: File[], roomCode: string, signal?: AbortSignal): Promise<DocumentReceipt[]> {
    const validationError = validateLobbyDocuments(files)
    if (validationError) throw new Error(validationError)

    const body = new FormData()
    for (const file of files) body.append('document', file)
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
    // Preserve the existing single-document response while supporting batch uploads.
    const receipts = isDocumentReceipt(payload) ? [payload]
        : typeof payload === 'object' && payload !== null && 'documents' in payload ? payload.documents : null
    if (!Array.isArray(receipts) || receipts.length !== files.length || !receipts.every(isDocumentReceipt)) {
        throw new Error('The document endpoint returned an unexpected response.')
    }
    return receipts
}
