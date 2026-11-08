import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { nextRoleIndex, roleMenuPlacement } from './rolePickerModel'

type RolePickerProps = {
    id: string
    playerName: string
    value: string
    roles: readonly { id: string; label: string }[]
    disabled?: boolean
    onChange: (role: string) => void
}

function RolePicker({ id, playerName, value, roles, disabled = false, onChange }: RolePickerProps) {
    const [isOpen, setIsOpen] = useState(false)
    const selectedIndex = Math.max(0, roles.findIndex((role) => role.id === value))
    const [activeIndex, setActiveIndex] = useState(selectedIndex)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const listRef = useRef<HTMLUListElement>(null)
    const searchRef = useRef({ text: '', updatedAt: 0 })
    const listId = `${id}-options`
    const menuOpen = isOpen && !disabled && roles.length > 0
    const activeOptionIndex = Math.min(activeIndex, Math.max(0, roles.length - 1))
    const selectedLabel = roles[selectedIndex]?.label ?? 'Choose a role'

    function close(restoreFocus = false) {
        setIsOpen(false)
        searchRef.current.text = ''
        if (restoreFocus) triggerRef.current?.focus()
    }

    useLayoutEffect(() => {
        if (!menuOpen) return
        let frame = 0
        let previousPlacement = ''
        const place = () => {
            const anchor = triggerRef.current
            const list = listRef.current
            if (!anchor || !list) return
            const position = roleMenuPlacement(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, list.scrollHeight)
            const placementKey = `${position.left},${position.top},${position.width},${position.height}`
            if (placementKey !== previousPlacement) {
                Object.assign(list.style, {
                    left: `${position.left}px`, top: `${position.top}px`,
                    width: `${position.width}px`, maxHeight: `${position.height}px`,
                })
                previousPlacement = placementKey
            }
            // Follow the trigger while its player row animates or the roster scrolls.
            frame = requestAnimationFrame(place)
        }
        place()
        listRef.current?.focus({ preventScroll: true })
        return () => cancelAnimationFrame(frame)
    }, [menuOpen])

    useEffect(() => {
        if (!menuOpen) return
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) {
                setIsOpen(false)
                searchRef.current.text = ''
            }
        }
        document.addEventListener('pointerdown', outside, true)
        return () => document.removeEventListener('pointerdown', outside, true)
    }, [menuOpen])

    useEffect(() => {
        if (!menuOpen) return
        const list = listRef.current
        const option = document.getElementById(`${listId}-${activeOptionIndex}`)
        if (!list || !option) return
        const optionBounds = option.getBoundingClientRect()
        const listBounds = list.getBoundingClientRect()
        if (optionBounds.top < listBounds.top) list.scrollTop -= listBounds.top - optionBounds.top
        else if (optionBounds.bottom > listBounds.bottom) list.scrollTop += optionBounds.bottom - listBounds.bottom
    }, [activeOptionIndex, menuOpen, listId])

    function choose(index: number) {
        if (disabled || !roles[index]) return
        onChange(roles[index].id)
        close(true)
    }

    function handleListKey(event: KeyboardEvent<HTMLUListElement>) {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            setActiveIndex((current) => nextRoleIndex(current, event.key, roles.length))
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            choose(activeOptionIndex)
        } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close(true)
        } else if (event.key === 'Tab') {
            close(true)
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            const now = performance.now()
            const search = (now - searchRef.current.updatedAt < 600 ? searchRef.current.text : '') + event.key.toLocaleLowerCase()
            searchRef.current = { text: search, updatedAt: now }
            const match = roles.findIndex((role) => role.label.toLocaleLowerCase().startsWith(search))
            if (match >= 0) setActiveIndex(match)
        }
    }

    return (
        <span className="lobby-role-picker">
            <button
                ref={triggerRef}
                id={id}
                className="lobby-role-select lobby-role-trigger"
                type="button"
                aria-label={`Role for ${playerName}: ${selectedLabel}`}
                disabled={disabled || roles.length === 0}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? listId : undefined}
                onClick={() => { if (disabled) return; setActiveIndex(selectedIndex); setIsOpen((open) => !open) }}
                onKeyDown={(event) => {
                    if (disabled) return
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault()
                        setActiveIndex(selectedIndex)
                        setIsOpen(true)
                    }
                }}
            >
                {selectedLabel}<span aria-hidden="true">⌄</span>
            </button>
            {menuOpen && createPortal(
                <ul ref={listRef} id={listId} className="lobby-role-menu" role="listbox" tabIndex={-1} aria-label={`Role for ${playerName}`} aria-activedescendant={`${listId}-${activeOptionIndex}`} onKeyDown={handleListKey}>
                    {roles.map((role, index) => (
                        <li
                            key={role.id}
                            id={`${listId}-${index}`}
                            className={`lobby-role-option${index === activeOptionIndex ? ' is-active' : ''}`}
                            role="option"
                            data-role-id={role.id}
                            aria-selected={role.id === value}
                            onPointerMove={() => setActiveIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(index)}
                        >
                            <span>{role.label}</span><span aria-hidden="true">{role.id === value ? '✓' : ''}</span>
                        </li>
                    ))}
                </ul>, document.body,
            )}
        </span>
    )
}

export default RolePicker
