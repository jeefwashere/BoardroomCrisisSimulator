import { useCallback, useSyncExternalStore } from 'react'

// Per window mute: every sound in the game is an HTMLMediaElement (stage <audio> elements and `new Audio()` clips).
// Muting keeps them playing silently, so `ended` still fires and voice driven turns advance as usual.
// The choice is remembered for this tab only, so each window (Alex, Morgan, Sam) can be muted on its own.
export const MUTE_STORAGE_KEY = 'boardroom.muted'

let muted = readStored()
const listeners = new Set<() => void>()
const started = new Set<HTMLMediaElement>()
let patched = false

function readStored(): boolean {
    try { return typeof window !== 'undefined' && window.sessionStorage.getItem(MUTE_STORAGE_KEY) === '1' } catch { return false }
}

function patchPlay() {
    if (patched || typeof HTMLMediaElement === 'undefined') return
    patched = true
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        this.muted = muted
        started.add(this)
        this.addEventListener('ended', () => started.delete(this), { once: true })
        return play.call(this)
    }
    // Native controls start playback without calling play(); media events do not bubble, so listen while capturing.
    document.addEventListener('play', (event) => { if (event.target instanceof HTMLMediaElement) event.target.muted = muted }, true)
}

function applyAll() {
    if (typeof document === 'undefined') return
    document.querySelectorAll('audio, video').forEach((element) => { (element as HTMLMediaElement).muted = muted })
    started.forEach((element) => { element.muted = muted })
}

export function setWindowMuted(next: boolean) {
    muted = next
    try { window.sessionStorage.setItem(MUTE_STORAGE_KEY, next ? '1' : '0') } catch { /* Lasts for this page only. */ }
    patchPlay()
    applyAll()
    listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

/** This window's mute state and a toggle. */
export function useWindowMute(): [boolean, () => void] {
    patchPlay()
    const value = useSyncExternalStore(subscribe, () => muted, () => false)
    const toggle = useCallback(() => setWindowMuted(!muted), [])
    return [value, toggle]
}
