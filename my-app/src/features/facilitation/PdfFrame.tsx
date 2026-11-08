/** Inline PDF viewer. Falls back to a plain link where the browser cannot render PDFs inline. */
export default function PdfFrame({ src, title, className = '' }: { src: string; title: string; className?: string }) {
    return <div className={`pdf-frame ${className}`.trim()}>
        <iframe src={`${src}#view=FitH`} title={`${title} (PDF viewer)`} loading="lazy" />
        <p className="pdf-frame-fallback">PDF not showing? <a href={src} target="_blank" rel="noopener noreferrer">Open it in a new tab</a>.</p>
    </div>
}
