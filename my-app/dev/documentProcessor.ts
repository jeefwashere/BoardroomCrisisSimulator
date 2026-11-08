import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DOCUMENT_PROCESSOR_ENDPOINT, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_FILES, validateLobbyDocuments } from '../src/features/lobby/documentContract.ts'

function sendJson(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(body))
}

// Development/preview stub only. Files are validated, acknowledged, and discarded.
// Replace this route with the real document processor; it never extracts or forwards content.
export function dummyDocumentProcessor(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (request.url?.split('?')[0] !== DOCUMENT_PROCESSOR_ENDPOINT) return next()
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST')
        sendJson(response, 405, { message: 'Use POST to upload a document.' })
        request.resume()
        return
    }

    const contentType = request.headers['content-type'] ?? ''
    if (!contentType.startsWith('multipart/form-data')) {
        sendJson(response, 400, { message: 'Upload the document using multipart form data.' })
        request.resume()
        return
    }

    const chunks: Buffer[] = []
    let receivedBytes = 0
    let rejected = false

    request.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length
        if (receivedBytes > MAX_DOCUMENT_FILES * MAX_DOCUMENT_BYTES + 128 * 1024) {
            if (!rejected) sendJson(response, 413, { message: 'The upload is too large. Choose up to 5 documents, at most 20 MB each.' })
            rejected = true
            chunks.length = 0
        } else if (!rejected) {
            chunks.push(chunk)
        }
    })

    request.on('end', () => {
        if (rejected) return
        void (async () => {
            try {
                const multipart = new Request('http://localhost/api/documents/process', {
                    method: 'POST',
                    headers: { 'Content-Type': contentType },
                    body: new Uint8Array(Buffer.concat(chunks)),
                })
                const form = await multipart.formData()
                const entries = form.getAll('document')
                if (entries.length === 0 || !entries.every((entry): entry is File => entry instanceof File)) {
                    sendJson(response, 400, { message: 'Choose a document to upload.' })
                    return
                }
                const error = validateLobbyDocuments(entries)
                if (error) {
                    sendJson(response, entries.some((document) => document.size > MAX_DOCUMENT_BYTES) ? 413 : 422, { message: error })
                    return
                }

                const documents = entries.map((document) => ({
                    documentId: randomUUID(),
                    filename: document.name,
                    bytesReceived: document.size,
                    status: 'received',
                    mode: 'dummy',
                    processed: false,
                    message: 'Upload received by the demo endpoint. No document content has been extracted or sent to an agent.',
                }))
                sendJson(response, 202, documents.length === 1 ? documents[0] : { documents })
            } catch {
                if (!response.headersSent) sendJson(response, 400, { message: 'The document upload could not be read.' })
            }
        })()
    })

    request.on('error', () => {
        rejected = true
        if (!response.headersSent) sendJson(response, 400, { message: 'The document upload was interrupted.' })
    })
}
