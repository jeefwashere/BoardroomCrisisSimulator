import { useMemo } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import { facilitationApi } from './facilitationClient'
import { groupClips } from './facilitationModel'
import ClipRow from './ClipRow'
import type { SharedAudioState } from './useSharedAudio'

export default function RecordingsTab({ clips, error, loading, onRetry, player, onToggle }: {
    clips: RecordedClip[]; error: string; loading: boolean; onRetry: () => void
    player: SharedAudioState; onToggle: (key: string, src: string) => void
}) {
    const groups = useMemo(() => groupClips(clips), [clips])
    return <div className="facilitation-recordings">
        <p className="facilitation-disclaimer"><strong>Recorded, fictional audio.</strong> These clips were prepared in advance. Listening is private to you and never counts as a turn, contribution or vote.</p>
        {error && <div className="facilitation-error" role="alert">
            <span>{error}</span>
            <button type="button" className="facilitation-secondary" onClick={onRetry}>Retry</button>
        </div>}
        {loading && <p className="facilitation-loading" role="status"><span className="facilitation-spinner" aria-hidden="true" /> Loading recorded audio…</p>}
        {!loading && !error && clips.length === 0 && <p className="facilitation-empty">No recorded clips are available.</p>}
        {groups.map((group) => <section key={group.group} className="facilitation-clip-group" aria-labelledby={`facilitation-group-${group.group}`}>
            <h3 id={`facilitation-group-${group.group}`}>{group.label} <span>{group.clips.length}</span></h3>
            {group.clips.map((clip) => <ClipRow key={clip.clip_id} clip={clip} src={facilitationApi.recordingUrl(clip)} player={player} onToggle={onToggle} />)}
        </section>)}
    </div>
}
