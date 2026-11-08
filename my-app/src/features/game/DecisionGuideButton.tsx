import { useEffect, useRef, useState } from 'react'
import { createFacilitationApi } from '../../services/facilitation'
import type { RecordedClip } from '../../services/facilitation'
import { roomApi } from '../rooms/useRoom'

const facilitationApi = createFacilitationApi(roomApi)

/** Compact player for the prerecorded T01 decision guide; playback never posts anything. */
export default function DecisionGuideButton() {
    const [clip, setClip] = useState<RecordedClip | null>(null)
    const [playing, setPlaying] = useState(false)
    const audio = useRef<HTMLAudioElement>(null)
    useEffect(() => {
        const controller = new AbortController()
        facilitationApi.recordings(controller.signal)
            .then((clips) => setClip(clips.find((item) => item.group === 'decision_guide') ?? null))
            .catch(() => undefined)
        return () => controller.abort()
    }, [])
    if (!clip) return null
    return <div className="vote-guide">
        <button type="button" className="vote-secondary" onClick={() => { const element = audio.current; if (!element) return; if (playing) element.pause(); else void element.play() }}>
            {playing ? 'Pause decision guide' : 'Play recorded decision guide'}
        </button>
        <span className="vote-guide-tag">RECORDED{clip.duration_seconds ? ` · ${Math.round(clip.duration_seconds)}s` : ''}</span>
        <audio ref={audio} src={facilitationApi.recordingUrl(clip)} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    </div>
}
