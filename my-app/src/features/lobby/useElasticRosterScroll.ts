import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { animate, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { clampScrollPosition, elasticScrollOffset, reversedScrollRange, wheelDeltaPixels } from './scrollMath'

export function useElasticRosterScroll(viewportRef: RefObject<HTMLDivElement | null>) {
    const reducedMotion = useReducedMotion() ?? false
    const scrollPosition = useSpring(0, { stiffness: 190, damping: 27, mass: 0.6 })
    const reboundY = useMotionValue(0)
    const targetRef = useRef(0)

    useEffect(() => {
        const viewportElement = viewportRef.current
        if (!viewportElement) return
        const viewport = viewportElement

        targetRef.current = viewport.scrollTop
        scrollPosition.jump(viewport.scrollTop)
        reboundY.jump(0)
        if (reducedMotion) return

        let stopTimer: ReturnType<typeof setTimeout> | undefined
        let reboundAnimation: { stop: () => void } | undefined
        let lastDirection = 0
        let previousPosition = viewport.scrollTop

        // A column-reverse viewport has negative scrollTop values above its bottom.
        const bounds = () => reversedScrollRange(viewport.scrollHeight, viewport.clientHeight)

        function scheduleRebound() {
            clearTimeout(stopTimer)
            stopTimer = setTimeout(() => {
                if (!lastDirection && Math.abs(reboundY.get()) < 0.1) return
                reboundAnimation?.stop()
                reboundAnimation = animate(reboundY, 0, {
                    type: 'spring', stiffness: 240, damping: 17, mass: 0.7,
                    // A small release velocity gives normal scrolling a gentle recoil too.
                    velocity: Math.abs(reboundY.get()) < 0.5 ? -lastDirection * 130 : 0,
                })
            }, 140)
        }

        const unsubscribe = scrollPosition.on('change', (value) => {
            const { min, max } = bounds()
            viewport.scrollTop = clampScrollPosition(value, min, max)
        })

        function onWheel(event: WheelEvent) {
            if (event.ctrlKey || (event.target instanceof Element && event.target.closest('select, option, input'))) return
            const { min, max } = bounds()
            if (min === max) return
            const delta = wheelDeltaPixels(event.deltaY, event.deltaMode, viewport.clientHeight)
            if (delta === 0) return

            event.preventDefault()
            lastDirection = Math.sign(delta)
            const requestedPosition = targetRef.current + delta
            const nextPosition = clampScrollPosition(requestedPosition, min, max)
            targetRef.current = nextPosition
            scrollPosition.set(nextPosition)

            const overshoot = requestedPosition - nextPosition
            if (overshoot !== 0 || Math.abs(reboundY.get()) > 0.1) {
                reboundAnimation?.stop()
                reboundAnimation = animate(reboundY, elasticScrollOffset(overshoot), {
                    type: 'spring', stiffness: 360, damping: 30, mass: 0.5,
                })
            }
            scheduleRebound()
        }

        function onScroll() {
            const actual = viewport.scrollTop
            const direction = Math.sign(actual - previousPosition)
            if (Math.abs(actual - previousPosition) > 0.5) lastDirection = direction
            previousPosition = actual

            const { min, max } = bounds()
            // Native touch, keyboard, focus, and scrollbar movement stay in control.
            if (Math.abs(actual - clampScrollPosition(scrollPosition.get(), min, max)) > 1.5) {
                targetRef.current = actual
                scrollPosition.jump(actual)
            }
            scheduleRebound()
        }

        const observer = new ResizeObserver(() => {
            const { min, max } = bounds()
            const boundedTarget = clampScrollPosition(targetRef.current, min, max)
            if (boundedTarget !== targetRef.current) {
                targetRef.current = boundedTarget
                scrollPosition.set(boundedTarget)
            }
        })
        observer.observe(viewport)
        if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
        viewport.addEventListener('wheel', onWheel, { passive: false })
        viewport.addEventListener('scroll', onScroll, { passive: true })

        return () => {
            clearTimeout(stopTimer)
            reboundAnimation?.stop()
            unsubscribe()
            observer.disconnect()
            viewport.removeEventListener('wheel', onWheel)
            viewport.removeEventListener('scroll', onScroll)
            scrollPosition.stop()
            reboundY.stop()
        }
    }, [viewportRef, scrollPosition, reboundY, reducedMotion])

    const scrollToLatest = useCallback(() => {
        targetRef.current = 0
        if (reducedMotion) {
            scrollPosition.jump(0)
            if (viewportRef.current) viewportRef.current.scrollTop = 0
        } else {
            scrollPosition.set(0)
        }
    }, [viewportRef, scrollPosition, reducedMotion])

    return { reboundY, scrollToLatest }
}
