// Facial expressions for the 3D boardroom characters, as morph target weights.
// The face rigged character GLBs (01-coo, 02-cfo, 03-cto) carry six morph targets on the face
// mesh, and `MouthOpen` again on a separate mouth interior mesh (teeth and cavity), which must
// move with the face. This module is pure so it can be unit tested without three.js.

export const FACE_MORPHS = ['Blink_L', 'Blink_R', 'Smile', 'Frown', 'BrowRaise', 'MouthOpen'] as const
export type FaceMorph = (typeof FACE_MORPHS)[number]
export type FaceWeights = Record<FaceMorph, number>

/** What a character's face reacts to; built by the scene from the board view each update. */
export type FaceContext = {
    phase: string
    /** This member is talking now (their clip, microphone or dictation). */
    talking: boolean
    /** Another member is talking now. */
    memberTalking: boolean
    /** An AI agent is talking from the table hub. */
    agentTalking: boolean
}

export const neutralFace = (): FaceWeights => ({ Blink_L: 0, Blink_R: 0, Smile: 0, Frown: 0, BrowRaise: 0, MouthOpen: 0 })

/**
 * The slow, held expression for the moment: the phase sets the tone, and listening or talking
 * adjust it. Blinks and the moving mouth are added on top by the scene.
 */
export function moodExpression(context: FaceContext): FaceWeights {
    const face = neutralFace()
    switch (context.phase) {
        case 'lobby':
            face.Smile = 0.25
            break
        case 'briefing':
        case 'reading':
            // Taking in the crisis: alert and a little concerned.
            face.BrowRaise = 0.25
            face.Frown = 0.1
            break
        case 'individual_decision':
            // Thinking it through alone.
            face.Frown = 0.35
            break
        case 'private_session':
            // With the coach and the Round 3 quiz: composed, so answer reactions stand out and the face
            // returns to a calm, neutral look between them.
            face.Frown = 0.08
            break
        case 'voting':
        case 'tie_break':
            face.Frown = 0.2
            break
        case 'ended':
            face.Smile = 0.55
            break
    }
    if (context.talking) {
        // Engaged while speaking: a warm base expression (faceFrame animates smile and brows on top), with the
        // phase's concern softened so no deep frown sits on the moving mouth.
        face.Smile = Math.max(Math.min(face.Smile, 0.3), 0.15)
        face.Frown = Math.min(face.Frown, 0.12)
        face.BrowRaise = Math.max(face.BrowRaise, 0.08)
    } else if (context.agentTalking) {
        // Listening to an expert or the coach: attentive and concentrating.
        face.BrowRaise = Math.max(face.BrowRaise, 0.2)
        face.Frown = Math.max(face.Frown, 0.1)
    } else if (context.memberTalking) {
        // Listening to a colleague: attentive.
        face.BrowRaise = Math.max(face.BrowRaise, 0.15)
    }
    return face
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = clamp01((x - edge0) / (edge1 - edge0))
    return t * t * (3 - 2 * t)
}

/** The most the mouth opens while speaking: a moderate, conversational opening, never a wide one. */
export const SPEECH_MOUTH_MAX = 0.32
/** The most a brow accent adds while speaking. */
export const SPEECH_BROW_MAX = 0.2

/**
 * Procedural speech mouth: syllables at about 4 to 5 per second, louder and quieter stretches,
 * and short pauses between phrases. `seed` keeps characters out of step. Returns 0 to
 * SPEECH_MOUTH_MAX, so the lips part a little instead of opening wide.
 * There is no audio level in the scene (audio stays with the stage hooks), so this is lip flap,
 * not lip sync.
 */
export function speechMouth(time: number, seed: number): number {
    const syllable = Math.abs(Math.sin(time * 14.2 + seed)) * (0.65 + 0.35 * Math.sin(time * 3.7 + seed * 1.7))
    const loudness = 0.75 + 0.25 * Math.sin(time * 1.3 + seed * 2.3)
    const phrase = smoothstep(-0.55, -0.15, Math.sin(time * 0.85 + seed * 3.1))
    return Math.min(SPEECH_MOUTH_MAX, 0.01 + (SPEECH_MOUTH_MAX - 0.01) * syllable * loudness * phrase)
}

/** Brow lifts that accent speech every couple of seconds. Returns 0 to SPEECH_BROW_MAX. */
export function speechBrow(time: number, seed: number): number {
    return SPEECH_BROW_MAX * Math.max(0, Math.sin(time * 1.7 + seed * 1.3)) ** 3
}

/** How much the smile swells and settles while speaking, so the face stays alive: -0.1 to 0.12. */
export function speechSmile(time: number, seed: number): number {
    return 0.11 * Math.sin(time * 0.9 + seed * 0.7) + 0.01 * Math.sin(time * 2.3 + seed)
}

/** A short reaction to a Round 3 answer: a frown for a wrong answer, a smile for the best one. */
export type FaceReaction = 'wrong' | 'partial' | 'best'
/** How long a reaction lasts: it builds quickly, holds while the result shows, then eases away. */
export const REACTION_SECONDS = 3
const REACTION_RISE = 0.3
const REACTION_FALL = 0.8

const REACTION_FACES: Record<FaceReaction, Pick<FaceWeights, 'Smile' | 'Frown' | 'BrowRaise'>> = {
    // Disappointed: a clear frown, brows level.
    wrong: { Smile: 0, Frown: 0.85, BrowRaise: 0 },
    // Partly right: a small, relieved smile.
    partial: { Smile: 0.3, Frown: 0, BrowRaise: 0.1 },
    // The best answer: a broad smile with lifted brows.
    best: { Smile: 0.85, Frown: 0, BrowRaise: 0.3 },
}

/** How strongly a reaction shows `age` seconds after it started: 0 to 1, and 0 once it is over. */
export function reactionStrength(age: number): number {
    if (age < 0 || age >= REACTION_SECONDS) return 0
    if (age < REACTION_RISE) return smoothstep(0, REACTION_RISE, age)
    if (age > REACTION_SECONDS - REACTION_FALL) return 1 - smoothstep(REACTION_SECONDS - REACTION_FALL, REACTION_SECONDS, age)
    return 1
}

/** The reaction's expression, for blending over the held one. */
export function reactionFace(reaction: FaceReaction): Pick<FaceWeights, 'Smile' | 'Frown' | 'BrowRaise'> {
    return { ...REACTION_FACES[reaction] }
}

type ReactionListener = (reaction: FaceReaction) => void
const reactionListeners = new Set<ReactionListener>()

/**
 * The game reports answer results here and the 3D scene, which loads separately, listens.
 * Returns the function that stops listening.
 */
export function onFaceReaction(listener: ReactionListener): () => void {
    reactionListeners.add(listener)
    return () => { reactionListeners.delete(listener) }
}

/** Shows `reaction` on your own character, if the 3D boardroom is open. */
export function emitFaceReaction(reaction: FaceReaction) {
    reactionListeners.forEach((listener) => listener(reaction))
}

const BLINK = { close: 0.07, hold: 0.04, open: 0.13 }

/**
 * Natural blinking: a blink every 2 to 6 seconds (a little more often while talking), with an
 * occasional double blink. `random` is injectable so tests are deterministic.
 */
export class Blinker {
    private wait: number
    private phase = -1 // seconds into the current blink, or -1 between blinks
    private pending = 0 // extra blinks queued (double blink)
    private readonly random: () => number

    constructor(random: () => number = Math.random) {
        this.random = random
        this.wait = 0.5 + this.random() * 3
    }

    /** Advance by dt seconds and return how closed the eyes are, 0 to 1. */
    update(dt: number, talking = false): number {
        if (this.phase < 0) {
            this.wait -= dt
            if (this.wait > 0) return 0
            this.phase = 0
        } else {
            this.phase += dt
        }
        const { close, hold, open } = BLINK
        const t = this.phase
        if (t < close) return t / close
        if (t < close + hold) return 1
        if (t < close + hold + open) return 1 - (t - close - hold) / open
        // Blink finished: schedule the next one.
        this.phase = -1
        if (this.pending > 0) {
            this.pending -= 1
            this.wait = 0.12
        } else {
            if (this.random() < 0.12) this.pending = 1
            this.wait = (talking ? 1.6 : 2) + this.random() * (talking ? 3 : 4)
        }
        return 0
    }
}

/** Ease a weight toward its target at `rate` per second, frame rate independent. */
export function approach(current: number, target: number, rate: number, dt: number): number {
    return target + (current - target) * Math.exp(-rate * dt)
}

/** A reaction in progress: which one, and how many seconds ago it started. */
export type ReactionState = { reaction: FaceReaction; age: number }

/**
 * One frame of a character's face: ease the held expression, add the blink and, while talking,
 * the moving mouth and brow accents. A reaction, while it lasts, blends over the held expression.
 * `state` holds the eased values between frames.
 */
export function faceFrame(state: FaceWeights, context: FaceContext, blink: number, time: number, seed: number, dt: number, reaction: ReactionState | null = null): FaceWeights {
    const mood = moodExpression(context)
    for (const morph of ['Smile', 'Frown', 'BrowRaise'] as const) state[morph] = approach(state[morph], mood[morph], 3, dt)
    const mouthTarget = context.talking ? speechMouth(time, seed) : 0
    // The mouth follows syllables smoothly and closes gently when speech stops.
    state.MouthOpen = approach(state.MouthOpen, mouthTarget, context.talking ? 16 : 8, dt)
    const out: FaceWeights = { ...state }
    if (context.talking) {
        out.BrowRaise = clamp01(out.BrowRaise + speechBrow(time, seed))
        out.Smile = clamp01(out.Smile + speechSmile(time, seed))
    }
    const strength = reaction ? reactionStrength(reaction.age) : 0
    if (reaction && strength > 0) {
        const face = reactionFace(reaction.reaction)
        for (const morph of ['Smile', 'Frown', 'BrowRaise'] as const) out[morph] = out[morph] + (face[morph] - out[morph]) * strength
    }
    out.Blink_L = blink
    out.Blink_R = blink
    return out
}
