import test from 'node:test'
import assert from 'node:assert/strict'
import { featuredDocument, mergeDocuments, sanitizeAttached, sanitizeCatalog } from '../src/features/facilitation/documentsModel.ts'
import { FacilitationError, createFacilitationApi } from '../src/services/facilitation.ts'
import type { IncidentDocument } from '../src/services/facilitation.ts'
import type { RoomApi } from '../src/services/rooms.ts'

function doc(document_id: string, isDefault = false): IncidentDocument {
    return { document_id, title: `Title ${document_id}`, filename: `${document_id}.pdf`, pack: document_id.toUpperCase(), default: isDefault, summary: 'Summary', pdf_url: `/api/documents/${document_id}/pdf` }
}

test('the attached default comes first, followed by the rest in catalog order', () => {
    const entries = mergeDocuments([doc('t02'), doc('t03'), doc('t01', true)], [{ document_id: 't01', title: 'Title t01', pdf_url: '/api/documents/t01/pdf' }])
    assert.deepEqual(entries.map((entry) => [entry.document_id, entry.attached]), [['t01', true], ['t02', false], ['t03', false]])
    assert.equal(featuredDocument(entries)?.document_id, 't01')
})

test('without room documents the catalog default is treated as attached', () => {
    const entries = mergeDocuments([doc('t02'), doc('t01', true)], null)
    assert.deepEqual(entries.map((entry) => [entry.document_id, entry.attached]), [['t01', true], ['t02', false]])
    assert.equal(featuredDocument(mergeDocuments([doc('t02')], null)), null)
})

test('attached documents missing from the catalog are still listed', () => {
    const entries = mergeDocuments([], [{ document_id: 't01', title: 'Outage', pdf_url: '/api/documents/t01/pdf' }])
    assert.deepEqual(entries.map((entry) => [entry.document_id, entry.attached, entry.title]), [['t01', true, 'Outage']])
    assert.equal(featuredDocument(entries)?.document_id, 't01')
})

test('malformed payloads are dropped safely', () => {
    assert.deepEqual(sanitizeCatalog({ detail: 'Not Found' }), [])
    assert.deepEqual(sanitizeCatalog([null, { document_id: 'x' }, { document_id: 't01', title: 'T', pdf_url: '/p', default: 'yes' }]).map((item) => [item.document_id, item.default, item.summary]), [['t01', false, '']])
    assert.deepEqual(sanitizeAttached(undefined), [])
    assert.deepEqual(sanitizeAttached([{ document_id: 't01', title: 'T', pdf_url: '/p', extra: 1 }]), [{ document_id: 't01', title: 'T', pdf_url: '/p' }])
})

test('the client lists documents, builds absolute PDF urls and reports a missing route as 404', async () => {
    const api = { baseUrl: 'http://api.test', authorized: async () => new Response('{}') } as unknown as RoomApi
    const client = createFacilitationApi(api)
    assert.equal(client.documentUrl({ pdf_url: '/api/documents/t01/pdf' }), 'http://api.test/api/documents/t01/pdf')
    assert.equal(client.documentUrl({ pdf_url: 'https://cdn.test/t01.pdf' }), 'https://cdn.test/t01.pdf')
    const originalFetch = globalThis.fetch
    try {
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            assert.equal(String(input), 'http://api.test/api/documents')
            return new Response(JSON.stringify([doc('t01', true)]), { status: 200 })
        }) as typeof fetch
        assert.deepEqual((await client.documents()).map((item) => item.document_id), ['t01'])
        globalThis.fetch = (async () => new Response('{"detail":"Not Found"}', { status: 404 })) as typeof fetch
        await assert.rejects(client.documents(), (error: unknown) => error instanceof FacilitationError && error.status === 404)
    } finally { globalThis.fetch = originalFetch }
})
