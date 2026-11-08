import { useState } from 'react'
import { facilitationApi } from './facilitationClient'
import type { DocumentEntry } from './documentsModel'
import type { MeetingDocumentsStatus } from './useMeetingDocuments'
import PdfFrame from './PdfFrame'

function DocumentIcon() {
    return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
}

function DocumentRow({ entry }: { entry: DocumentEntry }) {
    const [viewing, setViewing] = useState(false)
    const url = facilitationApi.documentUrl(entry)
    return <article className={`facilitation-document${entry.attached ? ' is-attached' : ''}`}>
        <div className="facilitation-document-head">
            <span className="facilitation-document-icon"><DocumentIcon /></span>
            <div className="facilitation-document-text">
                <div className="facilitation-clip-heading">
                    <h4>{entry.title}</h4>
                    {entry.attached && <span className="facilitation-badge facilitation-badge--attached">Attached to this meeting</span>}
                </div>
                <p className="facilitation-clip-meta">PDF{entry.pack ? ` · ${entry.pack}` : ''}{entry.filename ? ` · ${entry.filename}` : ''}</p>
                {entry.summary && <p className="facilitation-document-summary">{entry.summary}</p>}
            </div>
        </div>
        <div className="facilitation-document-actions">
            <a className="facilitation-secondary facilitation-document-open" href={url} target="_blank" rel="noopener noreferrer">Open PDF <span aria-hidden="true">↗</span></a>
            <button type="button" className="facilitation-link" aria-expanded={viewing} onClick={() => setViewing((value) => !value)}>{viewing ? 'Hide viewer' : 'View here'}</button>
        </div>
        {viewing && <PdfFrame src={url} title={entry.title} />}
    </article>
}

export default function DocumentsTab({ entries, status, error }: { entries: DocumentEntry[]; status: MeetingDocumentsStatus; error: string }) {
    return <div className="facilitation-documents">
        <p className="facilitation-disclaimer"><strong>Fictional incident reports.</strong> The attached report was shared with everyone before the meeting. Opening a PDF never counts as a turn, contribution or vote.</p>
        {status === 'loading' && <p className="facilitation-loading" role="status"><span className="facilitation-spinner" aria-hidden="true" /> Loading documents…</p>}
        {status === 'unavailable' && error && <p className="facilitation-loading" role="status"><span className="facilitation-spinner" aria-hidden="true" /> {error}</p>}
        {status === 'ready' && entries.length === 0 && <p className="facilitation-empty">No incident reports are available.</p>}
        {entries.map((entry) => <DocumentRow key={entry.document_id} entry={entry} />)}
    </div>
}
