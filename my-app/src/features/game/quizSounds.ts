// Round 3 sound effects, generated once with ElevenLabs sound effects and served as static files (no per play cost).
// They play through new Audio elements, so the window's Mute button silences them like every other game sound.
export type QuizSound = 'tick' | 'wrong' | 'partial' | 'best'

const FILES: Record<QuizSound, string> = { tick: 'quiz-tick.mp3', wrong: 'quiz-wrong.mp3', partial: 'quiz-partial.mp3', best: 'quiz-best.mp3' }
const loaded = new Map<QuizSound, HTMLAudioElement>()

function source(name: QuizSound): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null
    let audio = loaded.get(name)
    if (!audio) {
        audio = new Audio(`${import.meta.env.BASE_URL}sounds/${FILES[name]}`)
        audio.preload = 'auto'
        loaded.set(name, audio)
    }
    return audio
}

/** Fetches every quiz sound ahead of the first question so the first tick is not late. */
export function preloadQuizSounds() {
    (Object.keys(FILES) as QuizSound[]).forEach((name) => source(name))
}

/** Plays one sound; overlapping plays use copies. A blocked autoplay is ignored (sounds are a nicety, never required). */
export function playQuizSound(name: QuizSound, volume = 1) {
    const base = source(name)
    if (!base) return
    const clip = base.cloneNode(true) as HTMLAudioElement
    clip.volume = Math.min(1, Math.max(0, volume))
    void clip.play().catch(() => undefined)
}
