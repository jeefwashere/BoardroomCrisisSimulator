import './DemoEntryButton.css'

/** Home menu entry point for the single window three player demo. */
export default function DemoEntryButton({ disabled = false }: { disabled?: boolean }) {
    return <a className="demo-entry" href="#/demo" aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
        <span className="demo-entry__label">Try a 3 player demo</span>
        <span className="demo-entry__hint">Play Alex, Morgan and Sam in one window</span>
    </a>
}
