import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Countdown from './Countdown'
import { badgeText, formatClock } from './controlBarModel'
import type { MicControl } from './controlBarModel'
import './ControlBar.css'

type IconName = 'mic' | 'mic-off' | 'stop' | 'chat' | 'cc' | 'skip' | 'skip-speaker' | 'check' | 'end' | 'play' | 'cube' | 'doc' | 'speaker' | 'speaker-off'

function Icon({ name }: { name: IconName }) {
    const paths: Record<IconName, ReactNode> = {
        mic: <><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5 10.5v1a7 7 0 0 0 14 0v-1M12 18.5v3M8.5 21.5h7" /></>,
        'mic-off': <><path d="M15 9.4V5.5a3 3 0 0 0-5.7-1.3M9 9v2.5a3 3 0 0 0 4.9 2.3M19 10.5v1a7 7 0 0 1-1.1 3.8M5 10.5v1a7 7 0 0 0 11.4 5.4M12 18.5v3M8.5 21.5h7M3.5 3.5l17 17" /></>,
        stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" className="control-icon-fill" />,
        chat: <path d="M4.5 5.5h15a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H10l-4.5 3.5V17h-1a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />,
        cc: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M10.6 10.3a2.1 2.1 0 1 0 0 3.4M17.1 10.3a2.1 2.1 0 1 0 0 3.4" /></>,
        skip: <path d="M5 6l7 6-7 6V6ZM12.5 6l7 6-7 6V6Z" />,
        'skip-speaker': <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 9l4 3-4 3" /></>,
        check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
        play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" className="control-icon-fill" />,
        speaker: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
        'speaker-off': <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
        doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
        cube: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9" />,
        end: <path d="M3.2 14.6c4.9-4.6 12.7-4.6 17.6 0l-2.3 2.6-3.6-1.4v-2.6a10.4 10.4 0 0 0-5.8 0v2.6l-3.6 1.4-2.3-2.6Z" />,
    }
    return <svg className="control-icon" aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>
}

function ControlButton({ icon, label, title, onClick, disabled, tone, pressed, badge }: { icon: IconName; label: string; title?: string; onClick?: () => void; disabled?: boolean; tone?: 'live' | 'accent'; pressed?: boolean; badge?: number }) {
    // A disabled control keeps its tooltip on the wrapper, since disabled buttons do not receive pointer events.
    return <span className="control-slot" title={title}>
        <button type="button" className={`control-button${tone ? ` control-button--${tone}` : ''}`} disabled={disabled} aria-pressed={pressed} onClick={onClick}>
            <span className="control-disc"><Icon name={icon} />{badge ? <span className="control-badge" aria-label={`${badge} unread`}>{badgeText(badge)}</span> : null}</span>
            <span className="control-label">{label}</span>
        </button>
    </span>
}

export type ControlBarProps = {
    caption: string
    round: string | null
    phaseId: string
    deadline?: string | null
    serverTime?: string
    showCountdown: boolean
    pending: boolean
    mic: MicControl & { onClick: () => void }
    chat: { open: boolean; unread: number; onToggle: () => void }
    /** CC: the live transcript side panel. */
    captions?: { on: boolean; onToggle: () => void }
    /** Stage switch: the 3D boardroom or the call tiles, live, without reloading. */
    stage?: { threeD: boolean; onToggle: () => void }
    /** Mutes every sound in this window only (each player's window can be muted on its own). */
    mute?: { on: boolean; onToggle: () => void }
    /** The meeting's incident report PDF; shown once a report is available. */
    report?: { open: boolean; onToggle: () => void }
    autoResponse?: { label: string; live: boolean; disabled: boolean; title?: string; onClick: () => void }
    finishTurn?: () => void
    /** Open floor rooms: the CEO closes the meeting. */
    endMeeting?: () => void
    skip?: { label: string; onClick: () => void }
    skipSpeaker?: () => void
    end?: () => void
}

/** Zoom style call toolbar fixed to the bottom of the game screen. Host controls only render when the server allows them. */
export default function ControlBar({ caption, round, phaseId, deadline, serverTime, showCountdown, pending, mic, chat, captions, stage, mute, report, autoResponse, finishTurn, endMeeting, skip, skipSpeaker, end }: ControlBarProps) {
    const [armedEnd, setArmedEnd] = useState(false)
    const barRef = useRef<HTMLElement>(null)
    useLayoutEffect(() => {
        const bar = barRef.current
        if (!bar) return
        const screen = bar.closest<HTMLElement>('.game-call-screen') ?? bar.ownerDocument.documentElement
        const property = '--control-bar-occupied-height'
        const previous = screen.style.getPropertyValue(property)
        let measuredHeight = 0
        let frame: number | null = null
        const measure = () => {
            frame = null
            const height = Math.ceil(bar.getBoundingClientRect().height)
            if (height > 0 && height !== measuredHeight) {
                measuredHeight = height
                screen.style.setProperty(property, `${height}px`)
            }
        }
        // Defer observer driven style changes beyond its delivery cycle and merge repeated notifications.
        const scheduleMeasure = () => { if (frame === null) frame = requestAnimationFrame(measure) }
        measure()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
        observer?.observe(bar)
        window.addEventListener('resize', scheduleMeasure)
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', scheduleMeasure)
            if (frame !== null) cancelAnimationFrame(frame)
            if (previous) screen.style.setProperty(property, previous)
            else screen.style.removeProperty(property)
        }
    }, [])
    useEffect(() => {
        if (!armedEnd) return
        const timer = setTimeout(() => setArmedEnd(false), 4000)
        return () => clearTimeout(timer)
    }, [armedEnd])
    const micIcon: IconName = mic.live ? 'stop' : mic.muted ? 'mic-off' : 'mic'
    return <nav ref={barRef} className="control-bar" aria-label="Call controls">
        <div className="control-bar-status">
            <span className="control-phase" role="status">
                <span className="control-phase-dot" aria-hidden="true" />
                <span className="control-phase-text">{caption}</span>
                {showCountdown && <Countdown key={phaseId + (serverTime ?? '')} deadline={deadline} serverTime={serverTime} className="control-clock" format={formatClock} />}
            </span>
            {round && <span className="control-round">{round}</span>}
        </div>
        <div className="control-bar-center">
            <ControlButton icon={micIcon} label={mic.label} title={mic.title} disabled={!mic.action} tone={mic.live ? 'live' : undefined} pressed={mic.live} onClick={mic.onClick} />
            <ControlButton icon="chat" label="Chat" title={chat.open ? 'Close chat' : 'Open room chat'} pressed={chat.open} badge={chat.open ? 0 : chat.unread} onClick={chat.onToggle} />
            {captions && <ControlButton icon="cc" label="Captions" title={captions.on ? 'Hide the live transcript' : 'Show the live transcript'} pressed={captions.on} onClick={captions.onToggle} />}
            {stage && <ControlButton icon="cube" label="3D view" title={stage.threeD ? 'Switch to the call tiles' : 'Switch to the 3D boardroom'} pressed={stage.threeD} onClick={stage.onToggle} />}
            {mute && <ControlButton icon={mute.on ? 'speaker-off' : 'speaker'} label={mute.on ? 'Unmute' : 'Mute'} title={mute.on ? 'Turn this window\'s sound back on' : 'Mute all sound in this window only'} pressed={mute.on} onClick={mute.onToggle} />}
            {report && <ControlButton icon="doc" label="Report" title={report.open ? 'Close the incident report' : 'Open the incident report'} pressed={report.open} onClick={report.onToggle} />}
            {autoResponse && <ControlButton icon={autoResponse.live ? 'stop' : 'play'} label={autoResponse.label} title={autoResponse.title ?? 'Let the AI write and speak your reply'} tone={autoResponse.live ? 'live' : 'accent'} pressed={autoResponse.live} disabled={autoResponse.disabled} onClick={autoResponse.onClick} />}
            {finishTurn && <ControlButton icon="check" label="Finish my turn" title="Give up the floor so the next person can speak" tone="accent" disabled={pending} onClick={finishTurn} />}
            {endMeeting && <ControlButton icon="skip" label="Next stage" title="Move to the next stage (CEO only)" disabled={pending} onClick={endMeeting} />}
            {skip && <ControlButton icon="skip" label={skip.label} title={`${skip.label} (host)`} disabled={pending} onClick={skip.onClick} />}
            {skipSpeaker && <ControlButton icon="skip-speaker" label="Skip speaker" title="Move the floor to the next participant (host)" disabled={pending} onClick={skipSpeaker} />}
        </div>
        <div className="control-bar-end">
            {end && <button type="button" className={`control-end${armedEnd ? ' is-armed' : ''}`} disabled={pending} title="End this meeting for everyone and preserve its records"
                onClick={() => { if (!armedEnd) { setArmedEnd(true); return } setArmedEnd(false); end() }} onBlur={() => setArmedEnd(false)}>
                <Icon name="end" /><span>{armedEnd ? 'Click again to end' : 'End'}</span>
            </button>}
        </div>
    </nav>
}
