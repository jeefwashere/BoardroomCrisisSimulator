import { useRef, useState } from 'react'
import { MotionConfig } from 'motion/react'
import PlayerRoster from '../features/lobby/PlayerRoster'
import DocumentUpload from '../features/lobby/DocumentUpload'
import LobbyIcon from '../features/lobby/LobbyIcon'
import { useRoom } from '../features/rooms/useRoom'
import { roomMembers, startInput, startProblem } from '../features/rooms/roomState'
import type { RoleDraft } from '../features/rooms/roomState'
import type { StartRoomInput } from '../services/rooms'
import Game from './Game'
import RoomNameEditor from '../features/rooms/RoomNameEditor'
import RoomChat from '../features/rooms/RoomChat'
import './Host.css'

function Host({ roomId }: { roomId: string }) {
    const { room, scenarios, error, starting, start, rename, execute, refresh } = useRoom(roomId)
    const [draft, setDraft] = useState<RoleDraft>({})
    const [selectedScenario, setSelectedScenario] = useState('')
    const [selectedTiming, setSelectedTiming] = useState('')
    const [documentNotice, setDocumentNotice] = useState('Optional uploads are acknowledged only. They do not change the scenario.')
    const [notice, setNotice] = useState('')
    const startIntentRef = useRef<{ key: string; body: StartRoomInput } | null>(null)
    const scenario = scenarios.find((option) => `${option.scenario_id}:${option.version}` === selectedScenario) ?? scenarios[0]
    const timing = scenario?.timings.find((option) => option.profile_id === selectedTiming)?.profile_id ?? scenario?.timings[0]?.profile_id ?? ''
    const isHost = room?.self_member_id === room?.host_member_id

    async function copyRoomCode() {
        if (!room) return
        try { await navigator.clipboard.writeText(room.room_code); setNotice('Room code copied.') }
        catch { setNotice(`Your room code is ${room.room_code}.`) }
    }

    function submitStart() {
        if (!room || !scenario) return
        try {
            const body = startInput(room, scenario, timing, draft, '')
            const key = JSON.stringify(body)
            if (startIntentRef.current?.key !== key) startIntentRef.current = { key, body: { ...body, command_id: crypto.randomUUID() } }
            void start(startIntentRef.current.body)
        } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'Check the role assignments.') }
    }

    if (!room) return <main className="room-loading"><h1>Opening boardroom</h1><p role={error ? 'alert' : 'status'}>{error || 'Connecting to the room server…'}</p><button onClick={() => { window.location.hash = '/' }}>Back home</button></main>
    const problem = startProblem(room, scenario, draft)
    const members = roomMembers(room, isHost ? draft : {})

    return <>
        {room.phase !== 'lobby' ? <Game room={room} scenarios={scenarios} error={error} rename={rename} execute={execute} /> : <MotionConfig reducedMotion="user">
        <div className="host-lobby">
            <header className="lobby-toolbar">
                <div className="room-personal-controls"><button className="lobby-leave-button" type="button" title="Stop viewing. Your registered seat remains in this room." onClick={() => { window.location.hash = '/' }}>Leave</button><RoomNameEditor room={room} rename={rename} disabled={starting} /></div>
                <button className="lobby-room-code" type="button" onClick={() => void copyRoomCode()} aria-label={`Copy room code ${room.room_code}`} title="Copy room code"><span>Room code</span><strong>{room.room_code}</strong></button>
                {isHost ? <DocumentUpload roomCode={room.room_code} onContextChange={(context) => setDocumentNotice(`${context} This upload is not processed or used by the briefing.`)} /> : <span className="lobby-waiting">Waiting for the host</span>}
            </header>
            <main className="lobby-main" aria-labelledby="lobby-title">
                <h1 id="lobby-title" className="lobby-visually-hidden">{isHost ? 'Host' : 'Room'} lobby, {members.length} of {room.capacity} players</h1>
                <PlayerRoster members={members} editable={isHost && !starting} roles={[{ id: 'unassigned', label: 'Choose a role' }, ...scenario?.roles.map((role) => ({ id: role.role_id, label: role.name })) ?? []]} onAssignRole={(memberId, role) => { setDraft((current) => ({ ...current, [memberId]: role })); setNotice('') }} />
            </main>
            <footer className="lobby-context">
                <div className="lobby-scenario-controls">
                    <label>Scenario <select aria-label="Scenario" disabled={!isHost || starting} value={scenario ? `${scenario.scenario_id}:${scenario.version}` : ''} onChange={(event) => { setSelectedScenario(event.target.value); setDraft({}); setSelectedTiming('') }}>
                        {scenarios.map((option) => <option key={`${option.scenario_id}:${option.version}`} value={`${option.scenario_id}:${option.version}`}>{option.title} (v{option.version})</option>)}
                    </select></label>
                    <label>Timing <select aria-label="Timing profile" disabled={!isHost || starting} value={timing} onChange={(event) => setSelectedTiming(event.target.value)}>{scenario?.timings.map((option) => <option key={option.profile_id} value={option.profile_id}>{option.profile_id.replaceAll('_', ' ')} ({option.briefing_seconds}s briefing)</option>)}</select></label>
                </div>
                {isHost && <button className="lobby-start-button" type="button" disabled={starting || Boolean(problem)} onClick={submitStart} title={problem ?? 'Start the server briefing'}>{starting ? 'Starting…' : 'Start'} <LobbyIcon name="play" /></button>}
                <p className="lobby-live-status" role="status">{isHost ? problem ?? 'Ready. Start assigns these roles to all participants.' : 'The host assigns roles when the room starts.'} {room.members.filter((member) => member.connected).length} active.</p>
                {(error || notice) && <p role={error ? 'alert' : 'status'}>{error || notice}</p>}
                <p id="room-context" title={documentNotice}><span>Upload:</span> {documentNotice} The selected scenario supplies the briefing.</p>
            </footer>
        </div>
    </MotionConfig>}
        <RoomChat key={room.room_id} room={room} scenarios={scenarios} refreshRoom={refresh} />
    </>
}

export default Host
