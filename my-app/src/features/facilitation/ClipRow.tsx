import { useState } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import { formatDuration, progressFraction } from './facilitationModel'
import type { SharedAudioState } from './useSharedAudio'

export function PlayIcon({ playing }: { playing: boolean }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
        {playing ? <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></>
            : <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />}
    </svg>
}

export function ProgressBar({ active, player, fallbackDuration }: { active: boolean; player: SharedAudioState; fallbackDuration: number | null }) {
    const duration = active && player.duration > 0 ? player.duration : fallbackDuration ?? 0
    const fraction = active ? progressFraction(player.current, duration) : 0
    return <div className="facilitation-progress" role="progressbar" aria-label="Playback progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
        <span style={{ transform: `scaleX(${fraction})` }} />
    </div>
}

export default function ClipRow({ clip, src, player, onToggle, featured = false }: { clip: RecordedClip; src: string; player: SharedAudioState; onToggle: (key: string, src: string) => void; featured?: boolean }) {
    const [expanded, setExpanded] = useState(false)
    const key = `clip:${clip.clip_id}`
    const active = player.key === key
    const playing = active && player.playing
    const duration = formatDuration(clip.duration_seconds)
    const elapsed = active && (player.playing || player.current > 0) ? formatDuration(player.current) : ''
    return <article className={`facilitation-clip${featured ? ' facilitation-clip--featured' : ''}${active ? ' is-active' : ''}`}>
        <button type="button" className="facilitation-play" aria-label={`${playing ? 'Pause' : 'Play'} ${clip.label}`} aria-pressed={playing} onClick={() => onToggle(key, src)}>
            {active && player.loading ? <span className="facilitation-spinner" aria-hidden="true" /> : <PlayIcon playing={playing} />}
        </button>
        <div className="facilitation-clip-body">
            <div className="facilitation-clip-heading">
                <h4>{clip.label}</h4>
                <span className="facilitation-badge facilitation-badge--recorded">Recorded</span>
            </div>
            <p className="facilitation-clip-meta">{clip.speaker}{duration && <> · <span>{elapsed ? `${elapsed} / ` : ''}{duration}</span></>}</p>
            <ProgressBar active={active} player={player} fallbackDuration={clip.duration_seconds} />
            {active && player.error && <p className="facilitation-note facilitation-note--error" role="status">{player.error}</p>}
            {clip.text && <>
                <button type="button" className="facilitation-link" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide caption' : 'Show caption'}</button>
                {expanded && <p className="facilitation-caption">{clip.text}</p>}
            </>}
        </div>
    </article>
}
