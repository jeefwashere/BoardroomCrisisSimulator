import './DemoEntryButton.css'

/** Home menu entry point for the judge demo: one player plus automated board members. Host and Join cover real rooms. */
export default function DemoEntryButton({ disabled = false }: { disabled?: boolean }) {
    return <a className="demo-entry" href="#/demo" aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
        <span className="demo-entry__label">Judge demo</span>
        <span className="demo-entry__hint">Play Alex; AI board members play the rest</span>
    </a>
}
