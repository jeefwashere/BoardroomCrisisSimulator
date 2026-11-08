import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ReactNode } from 'react'
import type { RecordedClip } from '../../services/facilitation'
import type { RoomSnapshot } from '../../services/rooms'
import { facilitationApi, facilitationErrorMessage } from './facilitationClient'
import { decisionGuideClip, formatDuration } from './facilitationModel'
import { useSharedAudio } from './useSharedAudio'
import AdvisersTab from './AdvisersTab'
import RecordingsTab from './RecordingsTab'
import DocumentsTab from './DocumentsTab'
import { useMeetingDocuments } from './useMeetingDocuments'
import { PlayIcon, ProgressBar } from './ClipRow'
import './Facilitation.css'

type Tab = 'advisers' | 'recordings' | 'documents'
const TABS: { id: Tab; label: string }[] = [{ id: 'advisers', label: 'AI facilitators' }, { id: 'recordings', label: 'Recorded audio' }, { id: 'documents', label: 'Documents' }]

export default function FacilitationPanel({ room, review = false, recordingsContent, documentsContent, feedbackContent }: { room: RoomSnapshot; review?: boolean; recordingsContent?: ReactNode; documentsContent?: ReactNode; feedbackContent?: ReactNode }) {
    const [tab, setTab] = useState<Tab>('advisers')
    const [open, setOpen] = useState(false)
    const [clips, setClips] = useState<RecordedClip[]>([])
    const [clipsError, setClipsError] = useState('')
    const [clipsLoading, setClipsLoading] = useState(true)
    const [clipsToken, setClipsToken] = useState(0)
    const { state: player, toggle, stop, audioProps } = useSharedAudio()
    const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ advisers: null, recordings: null, documents: null })
    const documents = useMeetingDocuments(room.room_id)
    const id = useId()

    useEffect(() => {
        const controller = new AbortController()
        facilitationApi.recordings(controller.signal)
            .then((catalog) => { if (!controller.signal.aborted) { setClips(Array.isArray(catalog) ? catalog : []); setClipsError('') } })
            .catch((failure: unknown) => { if (!controller.signal.aborted) setClipsError(facilitationErrorMessage(failure, 'Recorded audio is unavailable right now.')) })
            .finally(() => { if (!controller.signal.aborted) setClipsLoading(false) })
        return () => controller.abort()
    }, [clipsToken])

    // Stop any playback when the meeting ends so audio never runs past the session.
    useEffect(() => { if (room.phase === 'ended') stop() }, [room.phase, stop])

    const guide = decisionGuideClip(clips)
    const guideKey = guide ? `clip:${guide.clip_id}` : ''
    const guideActive = guideKey !== '' && player.key === guideKey
    const guidePlaying = guideActive && player.playing
    const showGuide = room.phase === 'voting' && guide !== null

    function retryClips() { setClipsLoading(true); setClipsError(''); setClipsToken((token) => token + 1) }

    function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const index = TABS.findIndex((item) => item.id === tab)
        const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id
        setTab(next)
        tabRefs.current[next]?.focus()
    }

    if (review) return <section className="facilitation-panel facilitation-review" aria-label="Round review resources">
        <audio {...audioProps} />
        <details><summary>AI facilitators<span aria-hidden="true">+</span></summary>{feedbackContent}<AdvisersTab room={room} player={player} onToggle={toggle} review /></details>
        <details><summary>Recorded audio<span aria-hidden="true">+</span></summary>{recordingsContent}<RecordingsTab clips={clips} error={clipsError} loading={clipsLoading} onRetry={retryClips} player={player} onToggle={toggle} /></details>
        <details><summary>Documents<span aria-hidden="true">+</span></summary><DocumentsTab entries={documents.entries} status={documents.status} error={documents.error} />{documentsContent}</details>
    </section>
    return <aside className={`facilitation-panel${open ? ' is-open' : ''}`} aria-label="Meeting facilitation">
        <audio {...audioProps} />
        <button type="button" className="facilitation-collapse" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((value) => !value)}>
            <span>Facilitation, audio & documents</span>
            <span aria-hidden="true" className="facilitation-chevron">{open ? '−' : '+'}</span>
        </button>

        {showGuide && guide && <div className="facilitation-guide" role="region" aria-label="Recorded decision guide">
            <button type="button" className="facilitation-play facilitation-play--large" aria-pressed={guidePlaying} onClick={() => toggle(guideKey, facilitationApi.recordingUrl(guide))}>
                {guideActive && player.loading ? <span className="facilitation-spinner" aria-hidden="true" /> : <PlayIcon playing={guidePlaying} />}
            </button>
            <div className="facilitation-guide-body">
                <div className="facilitation-clip-heading">
                    <strong>{guidePlaying ? 'Pause recorded decision guide' : 'Play recorded decision guide'}</strong>
                    <span className="facilitation-badge facilitation-badge--recorded">Recorded</span>
                </div>
                <p className="facilitation-clip-meta">Voting is open. {guide.speaker}{guide.duration_seconds ? ` · ${formatDuration(guide.duration_seconds)}` : ''}. Listening does not cast a vote.</p>
                <ProgressBar active={guideActive} player={player} fallbackDuration={guide.duration_seconds} />
                {guideActive && player.error && <p className="facilitation-note facilitation-note--error" role="status">{player.error}</p>}
            </div>
        </div>}

        <div className="facilitation-body" id={`${id}-body`}>
            <div className="facilitation-tabs" role="tablist" aria-label="Facilitation views">
                {TABS.map((item) => <button key={item.id} ref={(node) => { tabRefs.current[item.id] = node }} type="button" role="tab" id={`${id}-tab-${item.id}`}
                    aria-selected={tab === item.id} aria-controls={`${id}-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1}
                    className={`facilitation-tab${tab === item.id ? ' is-selected' : ''}`} onClick={() => setTab(item.id)} onKeyDown={onTabKey}>
                    {item.label}
                </button>)}
            </div>
            <div role="tabpanel" id={`${id}-panel-advisers`} aria-labelledby={`${id}-tab-advisers`} hidden={tab !== 'advisers'} className="facilitation-tabpanel">
                <AdvisersTab room={room} player={player} onToggle={toggle} />
            </div>
            <div role="tabpanel" id={`${id}-panel-recordings`} aria-labelledby={`${id}-tab-recordings`} hidden={tab !== 'recordings'} className="facilitation-tabpanel">
                <RecordingsTab clips={clips} error={clipsError} loading={clipsLoading} onRetry={retryClips} player={player} onToggle={toggle} />
            </div>
            <div role="tabpanel" id={`${id}-panel-documents`} aria-labelledby={`${id}-tab-documents`} hidden={tab !== 'documents'} className="facilitation-tabpanel">
                <DocumentsTab entries={documents.entries} status={documents.status} error={documents.error} />
            </div>
        </div>
    </aside>
}
