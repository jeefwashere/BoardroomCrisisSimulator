export function nextRoleIndex(current: number, key: string, count: number): number {
    if (count <= 0) return -1
    if (key === 'Home') return 0
    if (key === 'End') return count - 1
    if (key === 'ArrowDown') return (current + 1 + count) % count
    if (key === 'ArrowUp') return (current - 1 + count) % count
    return current
}

export function roleMenuPlacement(anchor: { left: number; top: number; bottom: number; width: number }, viewport: { width: number; height: number }, contentHeight: number) {
    const margin = 12
    const gap = 6
    const width = Math.min(Math.max(anchor.width, 180), Math.max(1, viewport.width - margin * 2))
    const below = Math.max(0, viewport.height - anchor.bottom - margin - gap)
    const above = Math.max(0, anchor.top - margin - gap)
    const openBelow = below >= Math.min(contentHeight, 280) || below >= above
    const height = Math.min(contentHeight, 280, Math.max(36, openBelow ? below : above), Math.max(1, viewport.height - margin * 2))
    const left = Math.max(margin, Math.min(anchor.left + (anchor.width - width) / 2, viewport.width - width - margin))
    const top = openBelow ? anchor.bottom + gap : anchor.top - height - gap
    return { left, top: Math.max(margin, Math.min(top, viewport.height - height - margin)), width, height }
}
