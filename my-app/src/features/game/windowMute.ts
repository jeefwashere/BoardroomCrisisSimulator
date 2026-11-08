import { useCallback, useSyncExternalStore } from 'react'

// Per window mute: every sound in the game is an HTMLMediaElement (stage <audio> elements and `new Audio()` clips).
// Muting keeps them playing silently, so `ended` still fires and voice driven turns advance as usual.
// The choice is remembered for this tab only, so each window (Alex, Morgan, Sam) can be muted on its own.
export const MUTE_STORAGE_KEY = 'boardroom.muted'

let muted = readStored()
const listeners = new Set<() => void>()
const started = new Set<HTMLMediaElement>()
let patched = false
// Hung up: the call ended or the member left. Every sound stops, open speech streams are closed and nothing new may
// start (clips, voices or streams still finishing in the background would otherwise keep talking after the call).
let hungUp = false
const streams = new Set<AbortController>()

function readStored(): boolean {
    try { return typeof window !== 'undefined' && window.sessionStorage.getItem(MUTE_STORAGE_KEY) === '1' } catch { return false }
}

function patchPlay() {
    if (patched || typeof HTMLMediaElement === 'undefined') return
    patched = true
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        if (hungUp) return Promise.reject(new DOMException('The call has ended.', 'AbortError'))
        this.muted = muted
        started.add(this)
        this.addEventListener('ended', () => started.delete(this), { once: true })
        return play.call(this)
    }
    // Native controls start playback without calling play(); media events do not bubble, so listen while capturing.
    document.addEventListener('play', (event) => {
        if (!(event.target instanceof HTMLMediaElement)) return
        if (hungUp) event.target.pause()
        else event.target.muted = muted
    }, true)
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

/** Registers an open speech stream so hanging up closes it; returns the unregister function. */
export function trackSpeechStream(controller: AbortController): () => void {
    if (hungUp) controller.abort()
    else streams.add(controller)
    return () => { streams.delete(controller) }
}

/** End of call (or leaving the room): stop every sound in this window, close speech streams and block new playback. */
export function hangUpSound() {
    patchPlay()
    hungUp = true
    streams.forEach((controller) => controller.abort())
    streams.clear()
    started.forEach((element) => element.pause())
    started.clear()
    if (typeof document !== 'undefined') document.querySelectorAll('audio, video').forEach((element) => (element as HTMLMediaElement).pause())
}

/** A call is live again (a new game in this window). */
export function resumeSound() {
    hungUp = false
}

/** This window's mute state and a toggle. */
export function useWindowMute(): [boolean, () => void] {
    patchPlay()
    const value = useSyncExternalStore(subscribe, () => muted, () => false)
    const toggle = useCallback(() => setWindowMuted(!muted), [])
    return [value, toggle]
}
