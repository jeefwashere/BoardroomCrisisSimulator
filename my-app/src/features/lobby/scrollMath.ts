export function reversedScrollRange(scrollHeight: number, viewportHeight: number) {
    const overflow = Math.max(0, scrollHeight - viewportHeight)
    return { min: overflow > 0 ? -overflow : 0, max: 0 }
}

export function clampScrollPosition(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

export function wheelDeltaPixels(delta: number, mode: number, viewportHeight: number): number {
    if (!Number.isFinite(delta)) return 0
    return delta * (mode === 1 ? 16 : mode === 2 ? viewportHeight : 1)
}

export function elasticScrollOffset(overshoot: number): number {
    if (overshoot === 0) return 0
    const limit = 28
    return -Math.sign(overshoot) * limit * (1 - Math.exp(-Math.abs(overshoot) / limit))
}
