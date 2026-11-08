/**
 * Boardroom model downloads, shared and started early. The 3D scene only mounts when the game begins, so the lobby
 * and setup screens call `preloadBoardroomAssets()` to fetch every model while players are still joining; the scene
 * then parses bytes that are already in memory. No three.js here, so importing this costs nothing.
 */

export const MODELS = `${import.meta.env.BASE_URL}models/`
/** The ten seated characters, in seat fill order: the first member gets the first character, and so on (rooms hold 10). */
export const CHARACTER_IDS = [
    '01-coo', '03-cto', '06-head-of-communications', '02-cfo', '04-general-counsel',
    '05-head-of-hr', '07-marketing-director', '08-sales-manager', '09-operations-manager', '10-project-manager',
]
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
const swallow = (download: Promise<unknown>) => { download.catch(() => undefined) }

/**
 * Starts the model downloads in parallel; safe to call from any screen and again as members join. Only the characters
 * for the first `seats` seats are fetched, so a three person game does not download all ten.
 */
export function preloadBoardroomAssets(seats = 3): void {
    if (typeof fetch === 'undefined') return
    for (const id of CHARACTER_IDS.slice(0, Math.max(0, Math.min(seats, CHARACTER_IDS.length)))) swallow(fetchAsset(`${MODELS}characters/${id}.glb`))
    if (started) return
    started = true
    swallow(fetchAsset(`${MODELS}characters/animations.glb`))
    swallow(fetchAsset(`${MODELS}room/room.glb`))
    void propManifest().then((found) => {
        if (!found) return
        for (const word of PROP_WORDS) {
            const url = propUrl(found.models, word)
            if (url) swallow(fetchAsset(url))
        }
    })
}
