const ASPECT_RATIO = 16 / 10
const MIN_TILE_WIDTH = 144
const MAX_COLUMNS = 6
export const CALL_GRID_GAP = 12

export type CallLayout = {
    columns: number
    rows: number
    tileWidth: number
    tileHeight: number
    needsScroll: boolean
}

export function calculateCallLayout(count: number, width: number, height: number): CallLayout {
    if (count <= 0) return { columns: 0, rows: 0, tileWidth: 0, tileHeight: 0, needsScroll: false }

    const availableWidth = Math.max(1, width)
    const availableHeight = Math.max(1, height)
    let best: CallLayout | null = null

    // Choose the largest readable tiles that fit, rather than shrinking names indefinitely.
    for (let columns = 1; columns <= Math.min(count, MAX_COLUMNS); columns++) {
        const rows = Math.ceil(count / columns)
        const columnWidth = (availableWidth - CALL_GRID_GAP * (columns - 1)) / columns
        const rowHeight = (availableHeight - CALL_GRID_GAP * (rows - 1)) / rows
        const tileWidth = Math.floor(Math.min(columnWidth, rowHeight * ASPECT_RATIO))
        if (tileWidth < MIN_TILE_WIDTH) continue
        const tileHeight = Math.floor(tileWidth / ASPECT_RATIO)
        if (!best || tileWidth * tileHeight > best.tileWidth * best.tileHeight) {
            best = { columns, rows, tileWidth, tileHeight, needsScroll: false }
        }
    }
    if (best) return best

    const columns = Math.max(1, Math.min(count, MAX_COLUMNS, Math.floor((availableWidth + CALL_GRID_GAP) / (MIN_TILE_WIDTH + CALL_GRID_GAP))))
    const tileWidth = Math.max(1, Math.floor((availableWidth - CALL_GRID_GAP * (columns - 1)) / columns))
    return {
        columns,
        rows: Math.ceil(count / columns),
        tileWidth,
        tileHeight: Math.max(1, Math.floor(tileWidth / ASPECT_RATIO)),
        needsScroll: true,
    }
}
