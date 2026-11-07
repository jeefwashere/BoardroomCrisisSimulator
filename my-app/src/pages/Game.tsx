import { MotionConfig } from 'motion/react'
import type { LobbyMember } from '../features/lobby/lobbyModel'
import { MAX_LOBBY_MEMBERS } from '../features/lobby/lobbyModel'
import LobbyIcon from '../features/lobby/LobbyIcon'
import CallGrid from '../features/game/CallGrid'
import './Game.css'

type GameProps = {
    members: LobbyMember[]
    roomCode: string
    roomContext: string
    onReturnToLobby: () => void
}

// Temporary 2D stage. Keep room data outside the renderer so a future 3D scene
// can stay mounted behind blurred menus and become clear when Start is pressed.
function Game({ members, roomCode, roomContext, onReturnToLobby }: GameProps) {
    return (
        <MotionConfig reducedMotion="user">
            <div className="game-call-screen">
                <header className="game-call-header">
                    <button className="game-back-button" type="button" onClick={onReturnToLobby}>
                        <LobbyIcon name="back" /><span>Back to lobby</span>
                    </button>
                    <div className="game-call-heading">
                        <h1>Boardroom</h1>
                        <span>2D preview · {roomCode}</span>
                    </div>
                    <span className="game-player-count" aria-label={`${members.length} of ${MAX_LOBBY_MEMBERS} players`}>{members.length}<span> / {MAX_LOBBY_MEMBERS}</span></span>
                </header>

                <main className="game-call-main">
                    <CallGrid members={members} />
                </main>

                <footer className="game-call-footer">
                    <p title={roomContext}><span>Context:</span> {roomContext}</p>
                </footer>
            </div>
        </MotionConfig>
    )
}

export default Game
