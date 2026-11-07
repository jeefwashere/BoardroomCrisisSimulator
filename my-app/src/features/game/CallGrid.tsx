import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { LobbyMember } from '../lobby/lobbyModel'
import LobbyIcon from '../lobby/LobbyIcon'
import { calculateCallLayout } from './callLayout'
import { playerAvatarColor, playerInitials, playerRoleLabel } from './playerPresentation'

function CallGrid({ members }: { members: LobbyMember[] }) {
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
                        className="game-player-card"
                        style={{ width: layout.tileWidth, height: layout.tileHeight }}
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.2, delay: Math.min(index * 0.015, 0.15) }}
                        aria-label={`${member.name}, ${playerRoleLabel(member.role)}${member.isHost ? ', host' : ''}`}
                    >
                        {member.isHost && <span className="game-host-indicator" title="Host"><LobbyIcon name="crown" /><span className="game-visually-hidden">Host</span></span>}
                        <div className="game-player-presence" aria-hidden="true">
                            <span className="game-player-avatar" style={{ width: avatarSize, height: avatarSize, fontSize: Math.max(13, avatarSize * 0.36), backgroundColor: playerAvatarColor(member.id) }}>
                                {playerInitials(member.name)}
                            </span>
                        </div>
                        <div className="game-player-caption">
                            <h2 title={member.name}>{member.name}</h2>
                            <span title={playerRoleLabel(member.role)}>{playerRoleLabel(member.role)}</span>
                        </div>
                    </motion.article>
                ))}
                {members.length === 0 && <p className="game-empty-grid">No players in this preview.</p>}
            </div>
        </div>
    )
}

export default CallGrid
