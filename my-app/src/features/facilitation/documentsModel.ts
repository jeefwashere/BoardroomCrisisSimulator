// Pure helpers for the incident report PDFs (no JSX, no network) so they can be unit tested.
import type { AttachedDocument, IncidentDocument } from '../../services/facilitation.ts'

export type DocumentEntry = {
    document_id: string
    title: string
    pdf_url: string
    summary: string
    filename: string
    pack: string
    default: boolean
    attached: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function isDocumentLike(value: unknown): value is AttachedDocument {
    return isRecord(value) && typeof value.document_id === 'string' && value.document_id !== ''
        && typeof value.title === 'string' && typeof value.pdf_url === 'string' && value.pdf_url !== ''
}

/** Keeps only well formed catalog entries; anything else (including a non array payload) is dropped. */
export function sanitizeCatalog(payload: unknown): IncidentDocument[] {
    if (!Array.isArray(payload)) return []
    return payload.filter(isDocumentLike).map((item) => {
        const raw = item as AttachedDocument & Record<string, unknown>
        return {
            document_id: raw.document_id,
            title: raw.title,
            pdf_url: raw.pdf_url,
            filename: typeof raw.filename === 'string' ? raw.filename : '',
            pack: typeof raw.pack === 'string' ? raw.pack : '',
            default: raw.default === true,
            summary: typeof raw.summary === 'string' ? raw.summary : '',
        }
    })
}

export function sanitizeAttached(payload: unknown): AttachedDocument[] {
    return Array.isArray(payload) ? payload.filter(isDocumentLike).map(({ document_id, title, pdf_url }) => ({ document_id, title, pdf_url })) : []
}

/**
 * Merges the public catalog with the room's attached documents.
 * A document is attached when the room lists it, or, when the room did not report its documents
 * (older backend), when the catalog marks it as the default (the backend attaches it to every room).
 * Order: attached defaults, other attached, remaining defaults, then catalog order.
 * Attached documents missing from the catalog are still listed so a slow catalog never hides them.
 */
export function mergeDocuments(catalog: readonly IncidentDocument[], attached: readonly AttachedDocument[] | null): DocumentEntry[] {
    const attachedIds = new Set((attached ?? []).map((item) => item.document_id))
    const entries: DocumentEntry[] = catalog.map((item) => ({
        ...item,
        attached: attached === null ? item.default : attachedIds.has(item.document_id),
    }))
    for (const item of attached ?? []) {
        if (!entries.some((entry) => entry.document_id === item.document_id)) {
            entries.push({ ...item, summary: '', filename: '', pack: '', default: false, attached: true })
        }
    }
    const rank = (entry: DocumentEntry) => (entry.attached ? 0 : 2) + (entry.default ? 0 : 1)
    return entries.map((entry, index) => ({ entry, index }))
        .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
        .map(({ entry }) => entry)
}

/** The incident report to feature before the meeting: the attached default, else any attached, else the catalog default. */
export function featuredDocument(entries: readonly DocumentEntry[]): DocumentEntry | null {
    return entries.find((entry) => entry.attached && entry.default)
        ?? entries.find((entry) => entry.attached)
        ?? entries.find((entry) => entry.default)
        ?? null
}
