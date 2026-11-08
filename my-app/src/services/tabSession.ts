// The tab ID is public coordination data. Credentials never leave this tab's
// session storage except in requests to the application backend.
export const TAB_ID_KEY = 'boardroom.tabId'
export const TAB_TOKEN_KEY = 'boardroom.tabSession'

export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// A seat lets several same origin frames in one browser tab hold separate
// memberships, for the single window demo. Seats only namespace storage keys;
// each frame still claims its own tab ID.
const SEAT_PATTERN = /^[a-z0-9]{1,16}$/

export function validSeat(value: string | null | undefined): string | null {
    return typeof value === 'string' && SEAT_PATTERN.test(value) ? value : null
}

/** Reads `?seat=<name>` from a location search string; invalid seats are ignored. */
export function seatFromSearch(search: string): string | null {
    try { return validSeat(new URLSearchParams(search).get('seat')) } catch { return null }
}

/** Wraps storage so every key is suffixed with `.<seat>`. */
export function seatStorage(storage: StoragePort, seat: string): StoragePort {
    if (!validSeat(seat)) throw new Error('A seat uses 1 to 16 lowercase letters or digits.')
    const key = (name: string) => `${name}.${seat}`
    return {
        getItem: (name) => storage.getItem(key(name)),
        setItem: (name, value) => storage.setItem(key(name), value),
        removeItem: (name) => storage.removeItem(key(name)),
    }
}

/** Removes a seat's stored tab ID and credential. */
export function clearSeatSession(storage: StoragePort, seat: string): void {
    const seated = seatStorage(storage, seat)
    seated.removeItem(TAB_ID_KEY)
    seated.removeItem(TAB_TOKEN_KEY)
}
export type TabSession = {
    token(establish: (previous: string | null) => Promise<string>): Promise<string>
}
export type TabSessionOptions = {
    storage?: StoragePort | null
    randomId?: () => string
    claim?: (id: string) => Promise<boolean>
}

export function createTabSession(options: TabSessionOptions = {}): TabSession {
    const storage = options.storage ?? null
    const randomId = options.randomId ?? (() => crypto.randomUUID())
    let initialized: Promise<string> | undefined
    let memoryToken: string | null = null
    let memoryId: string | null = null
    function read(key: string) {
        try { return storage?.getItem(key) ?? null } catch { return null }
    }
    function write(key: string, value: string | null) {
        try { if (value === null) storage?.removeItem(key); else storage?.setItem(key, value) } catch { /* Memory remains usable. */ }
    }
    return {
        token(establish) {
            if (!initialized) {
                initialized = (async () => {
                    let id = memoryId ?? read(TAB_ID_KEY) ?? randomId()
                    let previous = memoryToken ?? read(TAB_TOKEN_KEY)
                    while (options.claim && !await options.claim(id)) {
                        id = randomId()
                        previous = null
                        memoryToken = null
                        write(TAB_TOKEN_KEY, null)
                    }
                    memoryId = id
                    write(TAB_ID_KEY, id)
                    const token = await establish(previous)
                    memoryToken = token
                    write(TAB_TOKEN_KEY, token)
                    return token
                })().catch((error: unknown) => { initialized = undefined; throw error })
            }
            return initialized
        },
    }
}

function browserClaim(): (id: string) => Promise<boolean> {
    let ownedId: string | null = null
    let release: (() => void) | undefined
    let channel: BroadcastChannel | undefined
    const nonce = crypto.randomUUID()
    window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload() })
    window.addEventListener('pagehide', () => { release?.(); ownedId = null; channel?.close() })
    return async (id) => {
        if (ownedId === id) return true
        if (navigator.locks) {
            return new Promise<boolean>((resolve, reject) => {
                void navigator.locks.request(`boardroom.tab.${id}`, { ifAvailable: true }, async (lock) => {
                    if (!lock) { resolve(false); return }
                    ownedId = id
                    await new Promise<void>((done) => { release = done; resolve(true) })
                }).catch(reject)
            })
        }
        // BroadcastChannel coordinates only nonsecret identifiers. Existing
        // owners win; simultaneous claimants use a deterministic nonce order.
        if (typeof BroadcastChannel === 'undefined') {
            throw new Error('This browser cannot safely keep separate player tabs. Use a browser with Web Locks or BroadcastChannel support.')
        }
        channel?.close()
        channel = new BroadcastChannel('boardroom.tab.claims')
        const activeChannel = channel
        let occupied = false
        activeChannel.onmessage = (event: MessageEvent<unknown>) => {
            const message = event.data as { id?: string; nonce?: string; type?: string }
            if (!message || message.id !== id || message.nonce === nonce) return
            if (message.type === 'probe') {
                if (ownedId === id) activeChannel.postMessage({ type: 'occupied', id, nonce })
                else {
                    activeChannel.postMessage({ type: 'candidate', id, nonce })
                    if (typeof message.nonce === 'string' && message.nonce < nonce) occupied = true
                }
            } else if (message.type === 'occupied' || (message.type === 'candidate' && typeof message.nonce === 'string' && message.nonce < nonce)) occupied = true
        }
        activeChannel.postMessage({ type: 'probe', id, nonce })
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (occupied) { activeChannel.close(); return false }
        ownedId = id
        return true
    }
}

let browserIdentity: TabSession | undefined
export function browserTabSession(): TabSession {
    if (!browserIdentity) {
        let storage: StoragePort | null = null
        try { if (typeof window !== 'undefined') storage = window.sessionStorage } catch { /* Use memory. */ }
        const seat = typeof window === 'undefined' ? null : seatFromSearch(window.location.search)
        if (storage && seat) storage = seatStorage(storage, seat)
        browserIdentity = createTabSession({ storage, ...(typeof window === 'undefined' ? {} : { claim: browserClaim() }) })
    }
    return browserIdentity
}
