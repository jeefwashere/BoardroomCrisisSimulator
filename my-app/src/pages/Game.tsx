import { MotionConfig } from 'motion/react'
import type { RoomSnapshot, Scenario } from '../services/rooms'
import { roomMembers } from '../features/rooms/roomState'
import LobbyIcon from '../features/lobby/LobbyIcon'
import CallGrid from '../features/game/CallGrid'
import './Game.css'

function Game({ room, scenarios, error }: { room: RoomSnapshot; scenarios: Scenario[]; error: string }) {
    if (!room.game) return null
    const game = room.game
    const scenario = scenarios.find((option) => option.scenario_id === game.scenario.scenario_id && option.version === game.scenario.version)
    const self = room.members.find((member) => member.member_id === room.self_member_id)
    return <MotionConfig reducedMotion="user">
        <div className="game-call-screen game-live-screen">
            <header className="game-call-header">
                <button className="game-back-button" type="button" title="Stop viewing. Your registered seat remains in this room." onClick={() => { window.location.hash = '/' }}><LobbyIcon name="back" /><span>Leave room</span></button>
                <div className="game-call-heading"><h1>Boardroom</h1><span>{room.phase} · {room.room_code}</span></div>
                <span className="game-player-count" aria-label={`${room.members.length} of ${room.capacity} players`}>{room.members.length}<span> / {room.capacity}</span></span>
            </header>
            <main className="game-call-main game-live-main">
                <CallGrid members={roomMembers(room, {}, scenario)} />
                <section className="game-briefing" aria-labelledby="briefing-title">
                    <h2 id="briefing-title">{game.scenario.title}</h2>
                    <p className="game-phase" role="status">Server phase: {room.phase}. Round {game.round_number}.</p>
                    {self && <p>Your role: {scenario?.roles.find((role) => role.role_id === self.role_id)?.name ?? self.role_id}. {self.eligible_current_round ? 'You are included in this round.' : `Your first eligible round is ${self.eligible_from_round ?? 'pending'}.`}</p>}
                    {error && <p role="alert">{error}</p>}
                    {game.public_documents.map((document) => <article key={document.id} className="game-public-document"><h3>{document.id.replaceAll('_', ' ')}</h3><div>{document.text}</div></article>)}
                    <p className="game-integration-note">Briefing is shared from the room server. Speaking, timed voting and automatic progression are not connected in this interface yet.</p>
                </section>
            </main>
            <footer className="game-call-footer"><p><span>Scenario:</span> {game.scenario.scenario_id}, version {game.scenario.version}. Room version {room.room_version}.</p></footer>
        </div>
    </MotionConfig>
}

export default Game
