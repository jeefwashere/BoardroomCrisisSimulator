import { useEffect, useMemo, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import type { RoomSnapshot } from '../../services/rooms'
import { pollRoom } from '../rooms/roomState'
import { facilitationApi, facilitationErrorMessage } from '../facilitation/facilitationClient'
import { formatDuration } from '../facilitation/facilitationModel'
import { useSharedAudio } from '../facilitation/useSharedAudio'
import { PlayIcon, ProgressBar } from '../facilitation/ClipRow'
import { assignSavedClips, cardStatus, clipForMember, commitEligibility, isOwnTurn, turnKey } from './savedClips'
import type { TurnView } from './savedClips'
import '../facilitation/Facilitation.css'

type Act = (path: string, fields?: Record<string, unknown>) => Promise<boolean>

const RETRY_MS = 5000
const audioKey = (clip: RecordedClip) => `saved:${clip.clip_id}`

function useParticipantCatalog() {
    const [catalog, setCatalog] = useState<RecordedClip[] | null>(null)
    const [error, setError] = useState('')
    useEffect(() => {
        const stop: () => void = pollRoom((signal) => facilitationApi.recordings(signal), (clips) => {
            setCatalog(Array.isArray(clips) ? clips : [])
            setError('')
            stop()
        }, (failure) => setError(facilitationErrorMessage(failure, 'Saved clips are unavailable right now.')), RETRY_MS)
        return stop
    }, [])
    return { catalog, error }
}

/**
 * Saved participant clips per turn (playtest "Play each participant manually").
 * Listening is local and never commits; only "Commit caption and pass" posts the exact caption, then passes the turn.
 */
export default function SavedClipTurn({ room, pending, act, finishPath }: { room: RoomSnapshot; pending: boolean; act: Act; finishPath: string }) {
    const game = room.game
    const { catalog, error } = useParticipantCatalog()
    const { state: player, toggle, stop, audioProps } = useSharedAudio()
    const [finishedTurn, setFinishedTurn] = useState<string | null>(null)
    const [committedTurn, setCommittedTurn] = useState<string | null>(null)
    const [committing, setCommitting] = useState(false)
    const [note, setNote] = useState<{ text: string; turn: string | null; sticky: boolean } | null>(null)
    const playback = useRef<{ clipId: string; turn: string | null } | null>(null)
    const latestTurn = useRef<string | null>(null)

    const view: TurnView = { phase: room.phase, phaseId: game?.phase_id ?? '', activeSpeakerId: game?.active_speaker_id, selfId: room.self_member_id }
    const currentTurn = turnKey(view)
    const ownTurn = isOwnTurn(view)
    const eligibleIds = game?.eligible_member_ids
    const assignments = useMemo(() => assignSavedClips(eligibleIds ?? [], catalog ?? []), [eligibleIds, catalog])
    const ownClip = clipForMember(assignments, room.self_member_id)

    useEffect(() => { latestTurn.current = currentTurn }, [currentTurn])
    useEffect(() => { if (room.phase === 'ended') stop() }, [room.phase, stop])

    if (!game || room.phase === 'ended') return null

    function listen(clip: RecordedClip) {
        const key = audioKey(clip)
        if (player.key === key && (player.playing || player.loading)) { stop(); playback.current = null; return }
        // Only a playback of your own clip during your own turn can unlock the commit for that turn.
        playback.current = { clipId: clip.clip_id, turn: ownTurn && ownClip?.clip_id === clip.clip_id ? currentTurn : null }
        setNote(null)
        toggle(key, facilitationApi.recordingUrl(clip))
    }

    function ended(event: SyntheticEvent<HTMLAudioElement>) {
        audioProps.onEnded(event)
        const finished = playback.current
        if (finished?.turn && finished.turn === currentTurn) {
            setFinishedTurn(finished.turn)
            setNote({ text: 'Playback finished. Commit the caption to pass the turn, or play it again.', turn: finished.turn, sticky: false })
        }
    }

    const alreadyCommitted = committedTurn !== null && committedTurn === currentTurn
    const eligibility = alreadyCommitted ? { allowed: false, reason: 'Caption committed for this turn.' }
        : commitEligibility({ view, clip: ownClip, finishedTurn, busy: committing || pending })
    const canFinish = (game.allowed_actions ?? []).includes('finish_speaking')

    async function commit() {
        if (!ownClip || !eligibility.allowed) return
        const turn = currentTurn
        stop()
        setCommitting(true)
        setNote(null)
        const done = (text: string) => setNote({ text, turn, sticky: true })
        try {
            const saved = await act('contributions', { kind: 'answer', source: 'typed', text: ownClip.text })
            if (!saved) return
            setCommittedTurn(turn)
            if (latestTurn.current !== turn) { done('Caption committed. The turn had already moved on, so nothing was passed.'); return }
            if (!canFinish) { done('Caption committed as your contribution.'); return }
            const passed = await act(finishPath)
            done(passed ? 'Caption committed and the turn passed to the next participant.' : 'Caption committed. Use “Finish my turn” to pass the turn.')
        } finally { setCommitting(false) }
    }

    const ownActive = ownClip !== null && player.key === audioKey(ownClip)
    const ownPlaying = ownActive && (player.playing || player.loading)

    return <section className="saved-clips" aria-labelledby="saved-clips-title">
        <audio {...audioProps} onEnded={ended} />
        <div className="saved-clips-header">
            <h3 id="saved-clips-title">Saved clips</h3>
            <span className="saved-clips-tag">RECORDED · fictional demo clip</span>
        </div>
        {catalog === null && !error && <p className="saved-clips-note" role="status">Loading saved clips…</p>}
        {catalog === null && error && <p className="saved-clips-note" role="status">{error} Retrying automatically.</p>}
        {catalog !== null && assignments.length === 0 && <p className="saved-clips-note">No saved participant clips are available for this meeting.</p>}

        {assignments.length > 0 && <ul className="saved-clips-strip">
            {assignments.map(({ memberId, clip }) => {
                const member = room.members.find((item) => item.member_id === memberId)
                const status = cardStatus(view, memberId)
                const key = audioKey(clip)
                const active = player.key === key
                const playing = active && (player.playing || player.loading)
                const self = memberId === room.self_member_id
                return <li key={clip.clip_id} className={`saved-clip-card${status.speaking ? ' is-speaking' : ''}${self ? ' is-self' : ''}`}>
                    <span className={`saved-clip-status${status.speaking ? ' is-speaking' : ''}`}>{status.label}</span>
                    <strong className="saved-clip-member">{member?.display_name ?? 'Former participant'}{self && <span> (you)</span>}</strong>
                    <span className="saved-clip-meta">{clip.speaker}{clip.duration_seconds ? ` · ${formatDuration(clip.duration_seconds)}` : ''}</span>
                    <span className="saved-clip-recorded">RECORDED · fictional demo clip</span>
                    <ProgressBar active={active} player={player} fallbackDuration={clip.duration_seconds} />
                    <button type="button" className="saved-clip-listen" aria-pressed={playing} aria-label={`${playing ? 'Stop' : 'Listen to'} ${member?.display_name ?? 'participant'}'s saved clip`} onClick={() => listen(clip)}>
                        {active && player.loading ? <span className="facilitation-spinner" aria-hidden="true" /> : <PlayIcon playing={playing} />}
                        {playing ? 'Stop' : 'Listen'}
                    </button>
                    {active && player.error && <span className="saved-clip-error" role="status">{player.error}</span>}
                </li>
            })}
        </ul>}

        {ownTurn && ownClip && <div className="saved-clip-turn" role="region" aria-label="Your saved clip turn">
            <p className="saved-clip-turn-title"><strong>It is your turn.</strong> Play your saved clip, then commit its caption to pass the turn. Playing alone never commits or passes.</p>
            <blockquote className="saved-clip-caption">{ownClip.text}</blockquote>
            <div className="saved-clip-turn-actions">
                <button type="button" className={ownPlaying ? 'saved-clip-stop' : ''} disabled={committing} onClick={() => listen(ownClip)}>{ownPlaying ? 'Stop' : 'Play my saved clip'}</button>
                <button type="button" disabled={!eligibility.allowed} onClick={() => void commit()}>{committing ? 'Committing…' : 'Commit caption and pass'}</button>
            </div>
            {!eligibility.allowed && eligibility.reason && <p className="saved-clips-note">{eligibility.reason}</p>}
            {ownActive && player.error && <p className="saved-clips-note saved-clips-note--error" role="status">{player.error}</p>}
        </div>}
        {ownTurn && !ownClip && catalog !== null && <p className="saved-clips-note">No saved clip is assigned to you. Speak, record or type your answer instead.</p>}
        {note && (note.sticky || note.turn === currentTurn) && <p className="saved-clips-note" role="status">{note.text}</p>}
    </section>
}
