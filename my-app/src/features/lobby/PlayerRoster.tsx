import { useLayoutEffect, useRef } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { getLobbyRows } from './lobbyModel'
import type { LobbyMember } from './lobbyModel'
import { useElasticRosterScroll } from './useElasticRosterScroll'
import LobbyIcon from './LobbyIcon'
import RolePicker from './RolePicker'

type PlayerRosterProps = {
    members: LobbyMember[]
    onAssignRole: (memberId: string, role: string) => void
}

const layoutTransition = { type: 'spring' as const, stiffness: 310, damping: 32 }

function PlayerRoster({ members, onAssignRole }: PlayerRosterProps) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const { reboundY, scrollToLatest } = useElasticRosterScroll(viewportRef)
    const rows = getLobbyRows(members)

    useLayoutEffect(() => {
        scrollToLatest()
    }, [members.length, scrollToLatest])

    return (
        <LayoutGroup>
            <motion.div ref={viewportRef} layoutScroll className="lobby-roster-viewport" tabIndex={0} aria-label="Scrollable player list">
                <motion.div className="lobby-roster" style={{ y: reboundY }} role="list" aria-label="Players in this lobby">
                    <AnimatePresence initial={false}>
                        {rows.map((row) => (
                            <motion.div
                                key={row[0].id}
                                layout="position"
                                role="presentation"
                                className="lobby-player-row"
                                initial={{ opacity: 0, y: 24 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{ layout: layoutTransition, opacity: { duration: 0.2 }, y: layoutTransition }}
                            >
                                <AnimatePresence initial={false}>
                                    {row.map((member, index) => (
                                        <motion.article
                                            key={member.id}
                                            layout="position"
                                            role="listitem"
                                            className="lobby-player-tile"
                                            initial={{ opacity: 0, x: index === 1 ? 32 : 0, scale: 0.96 }}
                                            animate={{ opacity: 1, x: 0, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.96 }}
                                            transition={{ layout: layoutTransition, default: { duration: 0.25 } }}
                                        >
                                            <span className="lobby-player-avatar" aria-hidden="true">
                                                {member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                                            </span>
                                            <div className="lobby-player-identity">
                                                <h2 className="lobby-player-name" title={member.name}>{member.name}</h2>
                                                {member.isHost && <span className="lobby-host-badge"><LobbyIcon name="crown" /> Host</span>}
                                            </div>
                                            <RolePicker id={`role-${member.id}`} playerName={member.name} value={member.role} onChange={(role) => onAssignRole(member.id, role)} />
                                        </motion.article>
                                    ))}
                                </AnimatePresence>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </motion.div>
            </motion.div>
        </LayoutGroup>
    )
}

export default PlayerRoster
