import { useEffect, useMemo, useState } from 'react'
import type { AttachedDocument, IncidentDocument } from '../../services/facilitation'
import { FacilitationError } from '../../services/facilitation'
import { pollRoom } from '../rooms/roomState'
import { facilitationApi } from './facilitationClient'
import { featuredDocument, mergeDocuments, sanitizeAttached, sanitizeCatalog } from './documentsModel'

const RETRY_MS = 5000

export type MeetingDocumentsStatus = 'loading' | 'ready' | 'unavailable'

type Loaded = { catalog: IncidentDocument[] | null; attached: AttachedDocument[] | null; error: string }

async function read(roomId: string, signal: AbortSignal): Promise<Loaded> {
    const [catalog, state] = await Promise.allSettled([facilitationApi.documents(signal), facilitationApi.state(roomId, signal)])
    const attached = state.status === 'fulfilled' && Array.isArray(state.value.documents) ? sanitizeAttached(state.value.documents) : null
    if (catalog.status === 'fulfilled') return { catalog: sanitizeCatalog(catalog.value), attached, error: '' }
    const failure = catalog.reason
    const error = failure instanceof FacilitationError && failure.status === 404
        ? 'The incident report library is not available on this server yet. Retrying automatically.'
        : 'The incident report library could not be reached. Retrying automatically.'
    return { catalog: null, attached, error }
}

/**
 * Incident report PDFs for a room: public catalog plus the room's attached documents.
 * Keeps retrying while the catalog route is missing (404) or unreachable, then stops.
 */
export function useMeetingDocuments(roomId: string) {
    const [loaded, setLoaded] = useState<Loaded & { done: boolean }>({ catalog: null, attached: null, error: '', done: false })
    useEffect(() => {
        const stop: () => void = pollRoom((signal) => read(roomId, signal), (incoming) => {
            setLoaded({ ...incoming, done: true })
            if (incoming.catalog !== null) stop()
        }, () => setLoaded((current) => ({ ...current, done: true, error: 'The incident report library could not be reached. Retrying automatically.' })), RETRY_MS)
        return stop
    }, [roomId])
    const entries = useMemo(() => mergeDocuments(loaded.catalog ?? [], loaded.attached), [loaded.catalog, loaded.attached])
    const status: MeetingDocumentsStatus = loaded.catalog !== null ? 'ready' : loaded.done ? 'unavailable' : 'loading'
    return { entries, featured: featuredDocument(entries), status, error: loaded.catalog !== null ? '' : loaded.error }
}
