import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { LobbyMember } from '../lobby/lobbyModel'
import LobbyIcon from '../lobby/LobbyIcon'
import { calculateCallLayout } from './callLayout'
import { TalkingBars } from './CallTile'
import { playerAvatarColor, playerInitials, playerRoleLabel } from './playerPresentation'

export type TileBadge = { label: string; tone: 'decide' | 'voted' | 'speaking' }

/** The participant grid. `talking` members animate (pulsing ring and audio bars); the call never shows their words. */
function CallGrid({ members, badges = {}, talking }: { members: LobbyMember[]; badges?: Record<string, TileBadge>; talking?: ReadonlySet<string> }) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ width: 0, height: 0 })

    useLayoutEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return
        const measure = () => {
            const width = Math.max(0, viewport.clientWidth - 24)
            const height = Math.max(0, viewport.clientHeight - 24)
            setSize((current) => current.width === width && current.height === height ? current : { width, height })
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(viewport)
        return () => observer.disconnect()
    }, [])

    const layout = calculateCallLayout(members.length, size.width, size.height)
    const avatarSize = Math.max(32, Math.min(80, layout.tileHeight * 0.35))

    return (
        <div ref={viewportRef} className="game-call-viewport" tabIndex={0} aria-label="Player call grid">
            <div className={`game-call-grid${layout.needsScroll ? ' game-call-grid--scrollable' : ''}`} role="list" aria-label="Players in the game">
                {members.map((member, index) => (
                    <motion.article
                        key={member.id}
                        role="listitem"
                        className={`game-player-card${badges[member.id] ? ` game-player-card--${badges[member.id].tone}` : ''}${talking?.has(member.id) ? ' game-player-card--talking' : ''}`}
                        style={{ width: layout.tileWidth, height: layout.tileHeight }}
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.2, delay: Math.min(index * 0.015, 0.15) }}
                        aria-label={`${member.name}, ${(member.roleLabel ?? playerRoleLabel(member.role))}${member.isHost ? ', host' : ''}${badges[member.id] ? `, ${badges[member.id].label}` : ''}`}
                    >
                        {badges[member.id] && <span className={`game-tile-badge game-tile-badge--${badges[member.id].tone}`} aria-hidden="true">{badges[member.id].label}</span>}
                        {member.isHost && <span className="game-host-indicator" title="Host"><LobbyIcon name="crown" /><span className="game-visually-hidden">Host</span></span>}
                        <div className="game-player-presence" aria-hidden="true">
                            <span className="game-player-avatar" style={{ width: avatarSize, height: avatarSize, fontSize: Math.max(13, avatarSize * 0.36), backgroundColor: playerAvatarColor(member.id) }}>
                                <span className="call-tile-ring" /><span className="call-tile-ring call-tile-ring--late" />
                                {playerInitials(member.name)}
                            </span>
                        </div>
                        <div className="game-player-caption">
                            <h2 title={member.name}>{member.name}</h2>
                            {member.connected !== undefined && <small>{member.connected ? 'Active' : 'Away'}</small>}
                            <span title={(member.roleLabel ?? playerRoleLabel(member.role))}>{(member.roleLabel ?? playerRoleLabel(member.role))}</span>
                            {talking?.has(member.id) && <TalkingBars />}
                        </div>
                    </motion.article>
                ))}
                {members.length === 0 && <p className="game-empty-grid">No participants in this room.</p>}
            </div>
        </div>
    )
}

export default CallGrid
