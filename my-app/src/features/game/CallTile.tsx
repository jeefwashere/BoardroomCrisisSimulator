import type { CSSProperties } from 'react'
import type { LobbyMember } from '../lobby/lobbyModel'
import LobbyIcon from '../lobby/LobbyIcon'
import { playerAvatarColor, playerInitials, playerRoleLabel } from './playerPresentation'

/** Animated audio bars shown beside the name of whoever is speaking. */
export function TalkingBars() {
    return <span className="call-bars" aria-hidden="true"><i /><i /><i /><i /></span>
}

/** The AI voice orb (rings pulse and waves move while the tile is talking). */
export function VoiceOrb() {
    return <div className="opening-orb call-orb" aria-hidden="true">
        <span className="opening-ring" />
        <span className="opening-ring opening-ring--late" />
        <span className="opening-core"><span className="opening-wave" /><span className="opening-wave" /><span className="opening-wave" /><span className="opening-wave" /></span>
    </div>
}

export type CallTileProps = {
    name: string
    role: string
    talking: boolean
    /** Small state chip in the corner ("Speaking", "Up next", "Listening"). Never spoken text. */
    status?: string
    size: 'main' | 'side' | 'small'
    /** An AI participant shows the voice orb; people show their initials. */
    avatar: { kind: 'orb' } | { kind: 'initials'; text: string; color: string }
    accent?: string
    host?: boolean
    className?: string
}

/** One "window" in a call: a person or an AI agent. Shows who is talking by animation only, never captions. */
export default function CallTile({ name, role, talking, status, size, avatar, accent, host, className }: CallTileProps) {
    const style = accent ? { '--tile-accent': accent } as CSSProperties : undefined
    return <article className={`call-tile call-tile--${size}${talking ? ' is-talking' : ''}${className ? ` ${className}` : ''}`} style={style}
        aria-label={`${name}, ${role}${talking ? ', speaking' : status ? `, ${status}` : ''}`}>
        {status && <span className="call-tile-status" aria-hidden="true">{status}</span>}
        {host && <span className="game-host-indicator" title="Host"><LobbyIcon name="crown" /><span className="game-visually-hidden">Host</span></span>}
        <div className="call-tile-presence" aria-hidden="true">
            {avatar.kind === 'orb' ? <VoiceOrb /> : <span className="call-tile-avatar" style={{ backgroundColor: avatar.color }}>
                <span className="call-tile-ring" /><span className="call-tile-ring call-tile-ring--late" />{avatar.text}
            </span>}
        </div>
        <div className="call-tile-caption" aria-hidden="true">
            <strong title={name}>{name}</strong>
            <span title={role}>{role}</span>
            {talking && <TalkingBars />}
        </div>
    </article>
}

/** A room member as a call tile. */
export function MemberTile({ member, talking, size, status, selfId }: { member: LobbyMember; talking: boolean; size: CallTileProps['size']; status?: string; selfId?: string }) {
    const self = member.id === selfId
    return <CallTile name={self ? `${member.name} (you)` : member.name} role={member.roleLabel ?? playerRoleLabel(member.role)} talking={talking} size={size} status={status}
        host={member.isHost} avatar={{ kind: 'initials', text: playerInitials(member.name), color: playerAvatarColor(member.id) }} />
}

/** The row of small member tiles under an AI agent's main window. */
export function MemberStrip({ members, talking, selfId }: { members: readonly LobbyMember[]; talking?: ReadonlySet<string>; selfId?: string }) {
    return <div className="call-strip" role="list" aria-label="Board members on the call">
        {members.map((member) => <div key={member.id} role="listitem"><MemberTile member={member} talking={Boolean(talking?.has(member.id))} size="small" selfId={selfId} /></div>)}
    </div>
}
