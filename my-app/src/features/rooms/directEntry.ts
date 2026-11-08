export function linkedJoinKey(mode: 'host' | 'join', code: string, name: string): string | null {
    const normalized = code.trim().toUpperCase()
    return mode === 'join' && /^[A-Z0-9]{6}$/.test(normalized) && name.trim()
        ? JSON.stringify([normalized, name]) : null
}

// The first StrictMode setup is cancelled before it can issue a command.
// Mark only dispatched intents, so a cleaned up setup can be scheduled again.
export function deferLinkedJoin(
    key: string | null,
    attempted: Set<string>,
    join: () => void,
    schedule: (callback: () => void) => ReturnType<typeof setTimeout> = (callback) => setTimeout(callback, 0),
    cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
): () => void {
    if (!key || attempted.has(key)) return () => {}
    const timer = schedule(() => {
        if (attempted.has(key)) return
        attempted.add(key)
        join()
    })
    return () => cancel(timer)
}
