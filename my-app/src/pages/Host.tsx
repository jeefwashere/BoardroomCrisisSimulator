import { useEffect, useState } from 'react'
import { MotionConfig } from 'motion/react'
import PlayerRoster from '../features/lobby/PlayerRoster'
import DocumentUpload from '../features/lobby/DocumentUpload'
import { addLobbyMember, assignLobbyRole, LOBBY_ROLES, MAX_LOBBY_MEMBERS } from '../features/lobby/lobbyModel'
import type { LobbyMember } from '../features/lobby/lobbyModel'
import './Host.css'

const previewNames = ['Alex Morgan', 'Jordan Lee', 'Sam Rivera', 'Taylor Chen', 'Casey Patel', 'Riley Brooks', 'Jamie Park', 'Avery Quinn']

function Host() {
    const [members, setMembers] = useState<LobbyMember[]>([
        { id: 'local-host', name: 'You', role: 'unassigned', isHost: true },
    ])
    const [roomCode] = useState(() => crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase())
    const [roomContext, setRoomContext] = useState('Upload a document to set the room context.')
    const [notice, setNotice] = useState('')
    const [previewTarget] = useState(() => {
        // Opt-in animation/scroll demo: #/host?preview=30. Normal lobbies start with just the host.
        const requested = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('preview'))
        return Number.isInteger(requested) && requested > 1 ? Math.min(requested, MAX_LOBBY_MEMBERS) : 1
    })

    useEffect(() => {
        if (members.length >= previewTarget) return
        const timer = window.setTimeout(() => {
            setMembers((current) => {
                const index = current.length - 1
                const cycle = Math.floor(index / previewNames.length)
                return addLobbyMember(current, {
                    id: `preview-player-${index}`,
                    name: previewNames[index % previewNames.length] + (cycle ? ` ${cycle + 1}` : ''),
                    role: 'unassigned',
                    isHost: false,
                })
            })
        }, 450)
        return () => window.clearTimeout(timer)
    }, [members.length, previewTarget])

    function assignRole(memberId: string, role: string) {
        try {
            setMembers((current) => assignLobbyRole(current, memberId, role))
            const name = members.find((member) => member.id === memberId)?.name
            const roleName = LOBBY_ROLES.find((option) => option.id === role)?.label
            setNotice(role === 'unassigned' ? `${name}'s role was cleared.` : `${name} is now assigned to ${roleName}.`)
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'The role could not be assigned.')
        }
    }

    async function copyRoomCode() {
        try {
            await navigator.clipboard.writeText(roomCode)
            setNotice('Room code copied.')
        } catch {
            setNotice(`Your room code is ${roomCode}.`)
        }
    }

    return (
        <MotionConfig reducedMotion="user">
            <div className="host-lobby">
                <header className="lobby-toolbar">
                    <button className="lobby-leave-button" type="button" onClick={() => { window.location.hash = '/' }}>
                        Leave
                    </button>
                    <button className="lobby-room-code" type="button" onClick={() => void copyRoomCode()} aria-label={`Copy room code ${roomCode}`} title="Copy room code">
                        <span>Room code</span>
                        <strong>{roomCode}</strong>
                    </button>
                    <DocumentUpload roomCode={roomCode} onContextChange={setRoomContext} />
                </header>

                <main className="lobby-main" aria-labelledby="lobby-title">
                    <h1 id="lobby-title" className="lobby-visually-hidden">Host lobby, {members.length} of {MAX_LOBBY_MEMBERS} players</h1>
                    <PlayerRoster members={members} onAssignRole={assignRole} />
                </main>

                <footer className="lobby-context">
                    <p id="room-context" role="status" aria-live="polite" aria-atomic="true" title={roomContext}>
                        <span>Context:</span> {roomContext}
                    </p>
                </footer>
                <p className="lobby-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{notice}</p>
            </div>
        </MotionConfig>
    )
}

export default Host
