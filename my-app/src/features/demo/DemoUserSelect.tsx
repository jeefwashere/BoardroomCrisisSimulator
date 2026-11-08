import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { nextRoleIndex } from '../lobby/rolePickerModel'

type Props = { users: { seat: string; name: string }[]; selected: number; onSelect: (index: number) => void }

export default function DemoUserSelect({ users, selected, onSelect }: Props) {
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(selected)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLUListElement>(null)
    const menuId = useId()
    const reducedMotion = useReducedMotion() ?? false

    function close(restoreFocus = false) {
        setOpen(false)
        if (restoreFocus) triggerRef.current?.focus()
    }

    function choose(index: number) {
        if (!users[index]) return
        onSelect(index)
        close(true)
    }

    useLayoutEffect(() => {
        if (!open) return
        let frame = 0
        const place = () => {
            const trigger = triggerRef.current
            const menu = menuRef.current
            if (!trigger || !menu) return
            const anchor = trigger.getBoundingClientRect()
            const width = Math.min(220, window.innerWidth - 24)
            Object.assign(menu.style, {
                left: `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`,
                bottom: `${Math.max(12, window.innerHeight - anchor.top + 8)}px`,
                width: `${width}px`, maxHeight: `${Math.max(44, anchor.top - 20)}px`,
            })
            frame = requestAnimationFrame(place)
        }
        place()
        menuRef.current?.focus({ preventScroll: true })
        return () => cancelAnimationFrame(frame)
    }, [open])

    useEffect(() => {
        if (!open) return
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false)
        }
        document.addEventListener('pointerdown', outside, true)
        return () => document.removeEventListener('pointerdown', outside, true)
    }, [open])

    useEffect(() => {
        if (!open) return
        const menu = menuRef.current
        const option = document.getElementById(`${menuId}-${activeIndex}`)
        if (!menu || !option) return
        const item = option.getBoundingClientRect()
        const bounds = menu.getBoundingClientRect()
        if (item.top < bounds.top) menu.scrollTop -= bounds.top - item.top
        else if (item.bottom > bounds.bottom) menu.scrollTop += item.bottom - bounds.bottom
    }, [open, activeIndex, menuId])

    const menu = <AnimatePresence>{open && <motion.ul ref={menuRef} id={menuId} role="listbox" tabIndex={-1} aria-label="Demo participant" aria-activedescendant={`${menuId}-${activeIndex}`} className="demo-user-options"
        initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}
        onKeyDown={(event) => {
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setActiveIndex((index) => nextRoleIndex(index, event.key, users.length)) }
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(activeIndex) }
            else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
            else if (event.key === 'Tab') close(true)
            else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const index = users.findIndex((user) => user.name.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()))
                if (index >= 0) { event.preventDefault(); setActiveIndex(index) }
            }
        }}>
        {users.map((user, index) => <motion.li id={`${menuId}-${index}`} key={user.seat} role="option" aria-selected={selected === index} className={activeIndex === index ? 'is-active' : ''}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18, delay: reducedMotion ? 0 : (users.length - index - 1) * 0.035 }}
            onPointerMove={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>{user.name}</motion.li>)}
    </motion.ul>}</AnimatePresence>

    return <>
        <button ref={triggerRef} className="demo-current-user" type="button" aria-label={`Current participant: ${users[selected]?.name}. Change participant`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined}
            onClick={() => { setActiveIndex(selected); setOpen((value) => !value) }}
            onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(selected); setOpen(true) } }}>{users[selected]?.name}</button>
        {typeof document !== 'undefined' && createPortal(menu, document.body)}
    </>
}
