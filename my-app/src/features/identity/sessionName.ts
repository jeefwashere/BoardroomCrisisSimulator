export const SESSION_NAME_KEY = 'boardroom.displayName'
export const MAX_NAME_LENGTH = 48

export type NameStorage = {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
}

export function normalizeDisplayName(value: string): string {
    return value.trim().replace(/\s+/gu, ' ')
}

export function displayNameError(value: string): string | null {
    const name = normalizeDisplayName(value)
    if (!name) return 'Enter a name to continue.'
    if (name.length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer.`
    return null
}

export function browserSessionStorage(): NameStorage | null {
    try {
        return typeof window === 'undefined' ? null : window.sessionStorage
    } catch {
        return null
    }
}

export function readSessionName(storage: NameStorage | null): string {
    try {
        const name = normalizeDisplayName(storage?.getItem(SESSION_NAME_KEY) ?? '')
        return displayNameError(name) ? '' : name
    } catch {
        return ''
    }
}

export function saveSessionName(storage: NameStorage | null, value: string): string {
    const name = normalizeDisplayName(value)
    const error = displayNameError(name)
    if (error) throw new Error(error)

    try {
        storage?.setItem(SESSION_NAME_KEY, name)
    } catch {
        // Still let the current visit work if the browser blocks storage.
    }
    return name
}

export function resolveNameEdit(currentName: string, draft: string): string {
    return displayNameError(draft) ? currentName : normalizeDisplayName(draft)
}
