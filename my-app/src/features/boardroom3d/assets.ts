/**
 * Boardroom model downloads, shared and started early. The 3D scene only mounts when the game begins, so the lobby
 * and setup screens call `preloadBoardroomAssets()` to fetch every model while players are still joining; the scene
 * then parses bytes that are already in memory. No three.js here, so importing this costs nothing.
 */

export const MODELS = `${import.meta.env.BASE_URL}models/`
export const CHARACTER_IDS = ['01-coo', '03-cto', '06-head-of-communications']
/** Props the scene places, matched by a word in their file name (see props.json). */
export const PROP_WORDS = ['table', 'chair', 'credenza', 'water-service', 'plant', 'clock', 'holo-hub', 'display', 'laptop', 'console'] as const
export type PropWord = (typeof PROP_WORDS)[number]

const downloads = new Map<string, Promise<ArrayBuffer>>()

/** One download per URL for the page's lifetime; a failed one is forgotten so the next call retries. */
export function fetchAsset(url: string): Promise<ArrayBuffer> {
    let download = downloads.get(url)
    if (!download) {
        download = fetch(url).then((response) => {
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
            return response.arrayBuffer()
        })
        download.catch(() => downloads.delete(url))
        downloads.set(url, download)
    }
    return download
}

type Manifest = { models: { file: string }[] }
let manifest: Promise<Manifest | null> | null = null

/** props.json, or null when it is missing (the scene keeps its simple stand-in furniture). */
export function propManifest(): Promise<Manifest | null> {
    manifest ??= fetch(`${MODELS}props/props.json`)
        .then((response) => response.ok && response.headers.get('content-type')?.includes('json') ? response.json() as Promise<Manifest> : null)
        .catch(() => null)
    return manifest
}

export function propUrl(entries: Manifest['models'], word: string): string | null {
    const entry = entries.find((item) => item.file.toLowerCase().includes(word))
    return entry ? `${MODELS}props/${entry.file.split('/').pop()}` : null
}

let started = false

/** Starts every model download in parallel (once); safe to call from any screen. */
export function preloadBoardroomAssets(): void {
    if (started || typeof fetch === 'undefined') return
    started = true
    const swallow = (download: Promise<unknown>) => { download.catch(() => undefined) }
    swallow(fetchAsset(`${MODELS}characters/animations.glb`))
    for (const id of CHARACTER_IDS) swallow(fetchAsset(`${MODELS}characters/${id}.glb`))
    swallow(fetchAsset(`${MODELS}room/room.glb`))
    void propManifest().then((found) => {
        if (!found) return
        for (const word of PROP_WORDS) {
            const url = propUrl(found.models, word)
            if (url) swallow(fetchAsset(url))
        }
    })
}
