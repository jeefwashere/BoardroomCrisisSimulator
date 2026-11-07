export const DOCUMENT_PROCESSOR_ENDPOINT = '/api/documents/process'
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
export const DOCUMENT_ACCEPT = '.doc,.docx,.pdf'

export type DocumentReceipt = {
    documentId: string
    filename: string
    bytesReceived: number
    status: 'received'
    mode: 'dummy'
    processed: false
    message: string
}

export function validateLobbyDocument(file: { name: string; size: number }): string | null {
    if (!/\.(docx?|pdf)$/i.test(file.name)) return 'Choose a DOC, DOCX, or PDF document.'
    if (file.size === 0) return 'This document is empty. Choose a file with content.'
    if (file.size > MAX_DOCUMENT_BYTES) return 'The document is too large. The limit is 20 MB.'
    return null
}

export function isDocumentReceipt(value: unknown): value is DocumentReceipt {
    if (typeof value !== 'object' || value === null) return false
    const receipt = value as Record<string, unknown>
    return typeof receipt.documentId === 'string'
        && typeof receipt.filename === 'string'
        && typeof receipt.bytesReceived === 'number'
        && receipt.status === 'received'
        && receipt.mode === 'dummy'
        && receipt.processed === false
        && typeof receipt.message === 'string'
}

export function formatDocumentSize(bytes: number): string {
    return bytes < 1024 * 1024
        ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
        : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function describeRoomContext(receipt: DocumentReceipt): string {
    return `${receipt.filename} · context awaiting document processing.`
}
