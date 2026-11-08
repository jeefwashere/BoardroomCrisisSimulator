import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

export default function DemoConfigPopover({ children, attention = false }: { children: ReactNode; attention?: boolean }) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const toggleRef = useRef<HTMLButtonElement>(null)
    const reducedMotion = useReducedMotion() ?? false
    useEffect(() => {
        if (!open) return
        rootRef.current?.querySelector<HTMLElement>('.demo-config__panel button, .demo-config__panel input')?.focus({ preventScroll: true })
        let blurTimer: ReturnType<typeof setTimeout> | undefined
        const outside = (event: PointerEvent) => {
            const target = event.target
            if (target instanceof Element && !rootRef.current?.contains(target) && !target.closest('.demo-user-options')) setOpen(false)
        }
        const iframeFocus = () => { blurTimer = setTimeout(() => { if (document.activeElement?.tagName === 'IFRAME') setOpen(false) }, 0) }
        document.addEventListener('pointerdown', outside, true)
        window.addEventListener('blur', iframeFocus)
        return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', iframeFocus); clearTimeout(blurTimer) }
    }, [open])

    return <div ref={rootRef} className="demo-config" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); toggleRef.current?.focus() }
    }}>
        <AnimatePresence>{open && <motion.section id="demo-config-panel" className="demo-config__panel" aria-label="Demo configuration"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 10 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
            {children}
        </motion.section>}</AnimatePresence>
        <button ref={toggleRef} className="demo-config__toggle" type="button" aria-expanded={open} aria-controls={open ? 'demo-config-panel' : undefined} aria-label={attention ? 'Demo config, attention needed' : 'Demo config'} onClick={() => setOpen((value) => !value)}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14M7 3v4m6 1v4m-7 1v4" /></svg>
            Demo config <span aria-hidden="true">{attention ? '●' : open ? '−' : '+'}</span>
        </button>
    </div>
}
