import { useEffect } from 'react'
import { facilitationApi } from '../facilitation/facilitationClient'
import PdfFrame from '../facilitation/PdfFrame'
import type { DocumentEntry } from '../facilitation/documentsModel'
import './ReportDialog.css'

/** The meeting's incident report PDF, opened from the control bar's Report button over the stage. */
export default function ReportDialog({ report, open, onClose }: { report: DocumentEntry | null; open: boolean; onClose: () => void }) {
    useEffect(() => {
        if (!open) return
        const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])
    if (!open || !report) return null
    const url = facilitationApi.documentUrl(report)
    return <section className="report-dialog" role="dialog" aria-modal="false" aria-labelledby="report-dialog-title">
        <header className="report-dialog-head">
            <div className="report-dialog-text">
                <span className="report-dialog-eyebrow">Incident report</span>
                <h2 id="report-dialog-title">{report.title}</h2>
            </div>
            <a className="report-dialog-link" href={url} target="_blank" rel="noopener noreferrer">Open in new tab <span aria-hidden="true">↗</span></a>
            <button type="button" className="report-dialog-close" aria-label="Close the report" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <PdfFrame src={url} title={report.title} className="report-dialog-frame" />
    </section>
}
