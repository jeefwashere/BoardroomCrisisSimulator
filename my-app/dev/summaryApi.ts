import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { summaryEmailError } from '../src/features/summary/summaryModel.ts'

function send(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(body))
}

// Local previews only: no summary generation, email delivery, persistence, or external calls.
export function dummySummaryApi(request: IncomingMessage, response: ServerResponse, next: () => void) {
    const match = /^\/api\/rooms\/([^/]+)\/summary(\/email)?$/.exec(request.url?.split('?')[0] ?? '')
    if (!match) return next()

    let roomCode: string
    try { roomCode = decodeURIComponent(match[1]) } catch {
        send(response, 400, { message: 'Invalid room code.' })
        request.resume()
        return
    }
    if (!roomCode.trim() || roomCode.length > 64) {
        send(response, 400, { message: 'Invalid room code.' })
        request.resume()
        return
    }

    const isEmail = Boolean(match[2])
    const method = isEmail ? 'POST' : 'GET'
    if (request.method !== method) {
        response.setHeader('Allow', method)
        send(response, 405, { message: `Use ${method} for this endpoint.` })
        request.resume()
        return
    }
    if (!isEmail) {
        send(response, 200, { roomCode, status: 'pending', summaries: [] })
        return
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
        send(response, 400, { message: 'Submit the email address as JSON.' })
        request.resume()
        return
    }

    const chunks: Buffer[] = []
    let bytes = 0
    let rejected = false
    request.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 8192) {
            if (!rejected) send(response, 413, { message: 'The email request is too large.' })
            rejected = true
            chunks.length = 0
        } else if (!rejected) chunks.push(chunk)
    })
    request.on('end', () => {
        if (rejected) return
        let payload: unknown
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
            send(response, 400, { message: 'The email request could not be read.' })
            return
        }
        const email = typeof payload === 'object' && payload !== null && 'email' in payload && typeof payload.email === 'string' ? payload.email : ''
        const error = summaryEmailError(email)
        if (error) { send(response, 422, { message: error }); return }

        send(response, 202, {
            requestId: randomUUID(),
            recipient: email.trim(),
            mode: 'dummy',
            status: 'preview',
            sent: false,
            message: 'Preview request received. Email delivery is not connected; no email was sent.',
        })
    })
    request.on('error', () => {
        rejected = true
        if (!response.headersSent) send(response, 400, { message: 'The email request was interrupted.' })
    })
}
