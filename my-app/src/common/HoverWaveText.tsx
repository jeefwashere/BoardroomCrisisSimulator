import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Variants } from 'motion/react'

type HoverWaveTextProps = {
    text: string
    className?: string
    entrance?: 'above' | 'below'
    visible?: boolean
}

function HoverWaveText({ text, className = '', entrance, visible = true }: HoverWaveTextProps) {
    const containerRef = useRef<HTMLSpanElement>(null)
    const frameRef = useRef<number | null>(null)
    const cursorRef = useRef<{ x: number; y: number } | null>(null)
    const hoverEnabledRef = useRef(!entrance)
    const reducedMotion = useReducedMotion() ?? false
    const letterVariants: Variants = {
        hidden: { opacity: 0, y: reducedMotion ? '0%' : entrance === 'above' ? '-100%' : '100%' },
        shown: (index: number) => {
            const delay = (entrance === 'above' ? 0.1 : 0) + index * 0.035
            return {
                opacity: 1,
                y: '0%',
                transition: reducedMotion ? { duration: 0 } : {
                    y: { type: 'spring', stiffness: 380, damping: 21, mass: 0.65, delay },
                    opacity: { duration: 0.18, delay },
                },
            }
        },
    }

    useEffect(() => () => {
        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current)
        }
    }, [])

    function updateLetters() {
        frameRef.current = null

        const container = containerRef.current
        const cursor = cursorRef.current
        if (!container || !cursor) return

        // Measure the stationary letter slots, then animate only their glyphs.
        // This keeps the hover positions stable as the letters grow and move.
        const letters = container.querySelectorAll<HTMLSpanElement>('.hover-wave-text__letter')
        const updates = Array.from(letters, (letter) => {
            const bounds = letter.getBoundingClientRect()
            const distanceX = Math.max(bounds.left - cursor.x, cursor.x - bounds.right, 0)
            const distanceY = Math.max(bounds.top - cursor.y, cursor.y - bounds.bottom, 0)
            const radius = Math.max(bounds.height * 0.85, 24)
            const proximity = Math.max(0, 1 - Math.hypot(distanceX, distanceY) / radius)
            const strength = proximity * proximity * (3 - 2 * proximity)

            return { letter, strength }
        })

        for (const { letter, strength } of updates) {
            letter.style.setProperty('--wave-strength', strength.toFixed(3))
            letter.style.zIndex = String(Math.round(strength * 100))
        }
    }

    function handlePointerMove(event: PointerEvent<HTMLSpanElement>) {
        if (!hoverEnabledRef.current || event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return
        }

        cursorRef.current = { x: event.clientX, y: event.clientY }

        if (frameRef.current === null) {
            frameRef.current = requestAnimationFrame(updateLetters)
        }
    }

    function resetLetters() {
        cursorRef.current = null

        if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current)
            frameRef.current = null
        }

        containerRef.current?.querySelectorAll<HTMLSpanElement>('.hover-wave-text__letter').forEach((letter) => {
            letter.style.removeProperty('--wave-strength')
            letter.style.removeProperty('z-index')
        })
    }

    return (
        <motion.span
            ref={containerRef}
            className={`hover-wave-text ${className}`.trim()}
            onPointerMove={handlePointerMove}
            onPointerLeave={resetLetters}
            onPointerCancel={resetLetters}
            initial={entrance ? 'hidden' : false}
            animate={entrance ? (visible ? 'shown' : 'hidden') : undefined}
            onAnimationStart={() => { if (entrance) { hoverEnabledRef.current = false; resetLetters() } }}
            onAnimationComplete={() => { hoverEnabledRef.current = visible }}
        >
            <span className="hover-wave-text__readable">{text}</span>
            <span aria-hidden="true">
                {Array.from(text).map((letter, index) => (
                    <motion.span className="hover-wave-text__letter" key={`${index}-${letter}`} custom={index} variants={entrance ? letterVariants : undefined}>
                        <span className="hover-wave-text__glyph">{letter === ' ' ? '\u00a0' : letter}</span>
                    </motion.span>
                ))}
            </span>
        </motion.span>
    )
}

export default HoverWaveText
