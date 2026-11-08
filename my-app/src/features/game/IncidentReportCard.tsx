import { useState } from 'react'
import { facilitationApi } from '../facilitation/facilitationClient'
import { useMeetingDocuments } from '../facilitation/useMeetingDocuments'
import PdfFrame from '../facilitation/PdfFrame'

/** The incident report PDF the playtest attached before the meeting, featured on the opening stage. */
export default function IncidentReportCard({ roomId }: { roomId: string }) {
    const { featured, status, error } = useMeetingDocuments(roomId)
    const [viewing, setViewing] = useState(false)
    const url = featured ? facilitationApi.documentUrl(featured) : ''
    return <section className="opening-report" aria-labelledby="opening-report-title">
        <div className="opening-report-head">
            <span className="opening-report-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
            </span>
            <div className="opening-report-text">
                <span className="opening-report-eyebrow" id="opening-report-title">Incident report (PDF)</span>
                {featured ? <>
                    <strong className="opening-report-name">{featured.title}</strong>
                    <span className="opening-report-meta">{featured.attached ? 'Attached to this meeting · shared with every participant' : 'Reference report'}</span>
                    {featured.summary && <p className="opening-report-summary">{featured.summary}</p>}
                </> : <span className="opening-report-meta" role="status">
                    {status === 'loading' ? 'Loading the attached incident report…'
                        : status === 'ready' ? 'No incident report is attached to this meeting.'
                            : error || 'The incident report is not available yet. Retrying automatically.'}
                </span>}
            </div>
        </div>
        {featured && <div className="opening-report-actions">
            <button type="button" className="opening-report-button" aria-expanded={viewing} onClick={() => setViewing((value) => !value)}>{viewing ? 'Hide report' : 'View report here'}</button>
            <a className="opening-report-link" href={url} target="_blank" rel="noopener noreferrer">Open PDF in new tab <span aria-hidden="true">↗</span></a>
        </div>}
        {featured && viewing && <PdfFrame src={url} title={featured.title} className="opening-report-frame" />}
    </section>
}
