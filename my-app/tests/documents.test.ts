import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { dummyDocumentProcessor } from '../dev/documentProcessor.ts'
import { describeRoomContext, describeDocumentsContext, DOCUMENT_PROCESSOR_ENDPOINT, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_FILES, isDocumentReceipt, validateLobbyDocument, validateLobbyDocuments } from '../src/features/lobby/documentContract.ts'
import { uploadLobbyDocument, uploadLobbyDocuments } from '../src/services/documents.ts'

const originalFetch = globalThis.fetch
const server = createServer((request, response) => {
    dummyDocumentProcessor(request, response, () => { response.writeHead(404).end() })
})
let baseUrl = ''

before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    baseUrl = `http://127.0.0.1:${address.port}`
    globalThis.fetch = (input, init) => originalFetch(typeof input === 'string' && input.startsWith('/') ? baseUrl + input : input, init)
})

after(async () => {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

function multipart(file?: File) {
    const body = new FormData()
    body.append('roomCode', 'DEMO01')
    if (file) body.append('document', file)
    return body
}

test('document validation accepts all three extensions and rejects empty, unsupported, and oversized files', () => {
    for (const name of ['brief.doc', 'brief.docx', 'brief.pdf', 'BRIEF.PDF']) {
        assert.equal(validateLobbyDocument({ name, size: 1024 }), null)
    }
    assert.match(validateLobbyDocument({ name: 'brief.pdf.exe', size: 1 })!, /DOC, DOCX, or PDF/)
    assert.match(validateLobbyDocument({ name: 'brief.docx', size: 0 })!, /empty/)
    assert.match(validateLobbyDocument({ name: 'brief.pdf', size: MAX_DOCUMENT_BYTES + 1 })!, /20 MB/)
})

test('real multipart requests receive a dummy receipt for DOC, DOCX, and PDF data', async () => {
    for (const extension of ['doc', 'docx', 'pdf']) {
        const file = new File(['fictional scenario fixture'], `brief.${extension}`)
        const response = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, { method: 'POST', body: multipart(file) })
        assert.equal(response.status, 202)
        const receipt = await response.json()
        assert.ok(isDocumentReceipt(receipt))
        assert.equal(receipt.filename, file.name)
        assert.equal(receipt.bytesReceived, file.size)
        assert.equal(receipt.processed, false)
        assert.equal(describeRoomContext(receipt), `${file.name} · context awaiting document processing.`)
        assert.match(receipt.message, /No document content has been extracted or sent to an agent/)
    }
})

test('the frontend upload adapter posts the file and reads the acknowledgement', async () => {
    const file = new File(['sample document bytes'], 'board-context.pdf')
    const receipt = await uploadLobbyDocument(file, 'DEMO01')
    assert.equal(receipt.filename, file.name)
    assert.equal(receipt.bytesReceived, file.size)
    assert.equal(receipt.mode, 'dummy')
    await assert.rejects(uploadLobbyDocument(new File(['not allowed'], 'notes.txt'), 'DEMO01'), /DOC, DOCX, or PDF/)
})

test('a batch accepts five files, preserves their names, and describes all uploaded documents', async () => {
    const files = Array.from({ length: MAX_DOCUMENT_FILES }, (_, index) => new File([`Document ${index}`], `brief-${index}.pdf`))
    const receipts = await uploadLobbyDocuments(files, 'DEMO01')
    assert.equal(receipts.length, 5)
    assert.deepEqual(receipts.map((receipt) => receipt.filename), files.map((file) => file.name))
    assert.ok(receipts.every((receipt, index) => receipt.processed === false && receipt.bytesReceived === files[index].size))
    const context = describeDocumentsContext(receipts)
    for (const file of files) assert.ok(context.includes(file.name))
    assert.match(context, /awaiting document processing/)
})

test('both the frontend and the endpoint reject more than five documents', async () => {
    const files = Array.from({ length: MAX_DOCUMENT_FILES + 1 }, (_, index) => new File(['fixture'], `${index}.docx`))
    assert.match(validateLobbyDocuments(files)!, /up to 5/)
    await assert.rejects(uploadLobbyDocuments(files, 'DEMO01'), /up to 5/)
    const body = multipart()
    for (const file of files) body.append('document', file)
    const response = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, { method: 'POST', body })
    assert.equal(response.status, 422)
    assert.match((await response.json()).message, /up to 5/)
})

test('batch validation checks every file and rejects an empty selection', async () => {
    const valid = new File(['fixture'], 'brief.pdf')
    assert.match(validateLobbyDocuments([])!, /at least one/)
    await assert.rejects(uploadLobbyDocuments([], 'DEMO01'), /at least one/)
    for (const invalid of [new File(['x'], 'brief.exe'), new File([], 'empty.doc'), new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'large.pdf')]) {
        assert.notEqual(validateLobbyDocuments([valid, invalid]), null)
        const body = multipart(valid)
        body.append('document', invalid)
        const response = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, { method: 'POST', body })
        assert.equal(response.status, invalid.size > MAX_DOCUMENT_BYTES ? 413 : 422)
    }
})

test('the dummy endpoint validates the multipart document on the server too', async () => {
    const missing = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, { method: 'POST', body: multipart() })
    assert.equal(missing.status, 400)
    for (const file of [new File(['x'], 'notes.exe'), new File([], 'empty.docx')]) {
        const response = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, { method: 'POST', body: multipart(file) })
        assert.equal(response.status, 422)
    }
    const oversized = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'large.pdf')
    const response = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, { method: 'POST', body: multipart(oversized) })
    assert.equal(response.status, 413)
})

test('bad methods, content types, malformed multipart data, and unrelated paths have explicit responses', async () => {
    const get = await fetch(DOCUMENT_PROCESSOR_ENDPOINT)
    assert.equal(get.status, 405)
    assert.equal(get.headers.get('allow'), 'POST')
    const json = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(json.status, 400)
    const malformed = await fetch(DOCUMENT_PROCESSOR_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=bad' }, body: 'not multipart' })
    assert.equal(malformed.status, 400)
    assert.equal((await fetch('/unrelated')).status, 404)
})

test('upload cancellation is honored', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(uploadLobbyDocument(new File(['fixture'], 'brief.pdf'), 'DEMO01', controller.signal), { name: 'AbortError' })
})

test('the frontend rejects processor failures and unexpected successful responses', async () => {
    const workingFetch = globalThis.fetch
    try {
        globalThis.fetch = async () => Response.json({ message: 'Processor is offline.' }, { status: 503 })
        await assert.rejects(uploadLobbyDocument(new File(['fixture'], 'brief.pdf'), 'DEMO01'), /Processor is offline/)
        globalThis.fetch = async () => new Response('<html>fallback</html>', { status: 200 })
        await assert.rejects(uploadLobbyDocument(new File(['fixture'], 'brief.pdf'), 'DEMO01'), /unexpected response/)
    } finally {
        globalThis.fetch = workingFetch
    }
})
