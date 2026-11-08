import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { revealedText } from './transcriptModel'
import type { TranscriptEntry } from './transcriptModel'

const TICK_MS = 80

/** One transcript line; a live line types out in step with its audio. */
function TranscriptLine({ entry }: { entry: TranscriptEntry }) {
    const [now, setNow] = useState(() => Date.now())
    const revealing = Boolean(entry.reveal && now < entry.reveal.startedAt + entry.reveal.durationMs)
    useEffect(() => {
        const reveal = entry.reveal
        if (!reveal) return
        const end = reveal.startedAt + reveal.durationMs
        const timer = setInterval(() => {
            const time = Date.now()
            setNow(time)
            if (time >= end) clearInterval(timer)
        }, TICK_MS)
        return () => clearInterval(timer)
    }, [entry.reveal])
    const text = revealing ? revealedText(entry.text, entry.reveal, now) : entry.text
    return <li className={`transcript-entry transcript-entry--${entry.tone}${entry.live ? ' is-live' : ''}`}>
        <div className="transcript-entry-head">
            <span className="transcript-speaker" style={entry.accent ? { color: `color-mix(in srgb, ${entry.accent} 50%, #ffffff 50%)` } : undefined}>{entry.speaker}</span>
            {entry.role && <span className="transcript-role">{entry.role}</span>}
            {entry.live && <span className="transcript-live"><span className="transcript-live-dot" aria-hidden="true" />Speaking</span>}
        </div>
        <p className="transcript-text">
            {/* Screen readers get each line once, in full; the typed reveal is visual only. */}
            <span className="game-visually-hidden">{entry.text}</span>
            <span aria-hidden="true">{text}{revealing && <span className="transcript-caret" />}</span>
        </p>
    </li>
}

/**
 * Right side "Live transcript" panel (captions). Newest lines at the bottom; it follows new text unless the reader has
 * scrolled up. `dock` is a slot at the bottom where a stage can render its answer box (private sessions).
 */
export default function TranscriptPanel({ entries, open, onClose, dockRef }: {
    entries: readonly TranscriptEntry[]
    open: boolean
    onClose: () => void
    dockRef?: (element: HTMLDivElement | null) => void
}) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLOListElement>(null)
    const stuck = useRef(true)
    // Follow growing text (new lines and the typed reveal) while the reader is at the bottom.
    useLayoutEffect(() => {
        const scroller = scrollRef.current
        const list = listRef.current
        if (!scroller || !list) return
        const follow = () => { if (stuck.current) scroller.scrollTop = scroller.scrollHeight }
        follow()
        const observer = new ResizeObserver(follow)
        observer.observe(list)
        return () => observer.disconnect()
    }, [])
    useEffect(() => { if (open && stuck.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [open])
    return <aside className={`transcript-panel${open ? ' is-open' : ''}`} aria-label="Live transcript" aria-hidden={!open} inert={!open}>
        <header className="transcript-header">
            <h2>Live transcript</h2>
            <button type="button" className="transcript-close" aria-label="Hide captions" title="Hide captions (CC)" onClick={onClose}>×</button>
        </header>
        <div ref={scrollRef} className="transcript-scroll" onScroll={(event) => {
            const element = event.currentTarget
            stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
        }}>
            <ol ref={listRef} className="transcript-list" aria-live="polite" aria-relevant="additions">
                {entries.map((entry) => <TranscriptLine key={entry.id} entry={entry} />)}
            </ol>
            {entries.length === 0 && <p className="transcript-empty">Captions appear here as each person speaks.</p>}
        </div>
        <div ref={dockRef} className="transcript-dock" />
    </aside>
}
