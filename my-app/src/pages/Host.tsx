import { useRef, useState } from 'react'
import { MotionConfig } from 'motion/react'
import PlayerRoster from '../features/lobby/PlayerRoster'
import DocumentUpload from '../features/lobby/DocumentUpload'
import LobbyIcon from '../features/lobby/LobbyIcon'
import RolePicker from '../features/lobby/RolePicker'
import { useRoom } from '../features/rooms/useRoom'
import { roomMembers, startInput, startProblem } from '../features/rooms/roomState'
import type { RoleDraft } from '../features/rooms/roomState'
import type { RoomSnapshot, StartRoomInput } from '../services/rooms'
import Game from './Game'
import Summary from './Summary'
import LobbyNameEditor from '../features/rooms/LobbyNameEditor'
import RoomChat from '../features/rooms/RoomChat'
import HostLeavePrompt from '../features/rooms/HostLeavePrompt'
import SessionEnded from '../features/rooms/SessionEnded'
import { sessionClosure } from '../features/rooms/sessionClosure'
import RoomCodeButton from '../features/lobby/RoomCodeButton'
import './Host.css'

function Host({ roomId, initialRoom, showChat = true, onLeaveDemo }: { roomId: string; initialRoom?: RoomSnapshot; showChat?: boolean; onLeaveDemo?: () => void }) {
    const { room, scenarios, error, accessError, starting, leaving, start, leave, rename, execute, refresh } = useRoom(roomId, initialRoom)
    const [draft, setDraft] = useState<RoleDraft>({})
    const [selectedScenario, setSelectedScenario] = useState('')
    const [selectedTiming, setSelectedTiming] = useState('')
    const [documentNotice, setDocumentNotice] = useState('Optional uploads are acknowledged only. They do not change the scenario.')
    const [notice, setNotice] = useState('')
    const [confirmLeave, setConfirmLeave] = useState(false)
    const [isDocumentUploading, setIsDocumentUploading] = useState(false)
    const summaryPreview = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('preview') === 'summary'
    function showSummaryPreview() { window.location.hash = `/room/${roomId}?preview=summary` }
    function returnToRoom() { window.location.hash = `/room/${roomId}` }
    const startIntentRef = useRef<{ key: string; body: StartRoomInput } | null>(null)
    const scenario = scenarios.find((option) => `${option.scenario_id}:${option.version}` === selectedScenario) ?? scenarios[0]
    const timing = scenario?.timings.find((option) => option.profile_id === selectedTiming)?.profile_id ?? scenario?.timings[0]?.profile_id ?? ''
    const isHost = room?.self_member_id === room?.host_member_id
    const controlsDisabled = starting || leaving || isDocumentUploading

    async function leaveLobby() {
        if (onLeaveDemo) { onLeaveDemo(); return }
        try { await leave(); window.location.hash = '/' }
        catch (failure) { setNotice(failure instanceof Error ? failure.message : 'The lobby could not be left. Please try again.') }
    }

    function requestLeave() {
        if (onLeaveDemo) onLeaveDemo()
        else if (isHost) setConfirmLeave(true)
        else void leaveLobby()
    }

    async function confirmHostLeave() {
        await leave()
        window.location.hash = '/'
    }

    function backHome() {
        if (onLeaveDemo) onLeaveDemo()
        else window.location.hash = '/'
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

    const closure = sessionClosure(accessError)
    if (closure) return <SessionEnded reason={closure} onBack={backHome} />
    if (accessError) return <main className="room-loading"><h1>Room unavailable</h1><p role="alert">{accessError.message}</p><button className="room-text-button" type="button" onClick={backHome}>Back home</button></main>
    if (!room) return <main className="room-loading"><h1>Opening boardroom</h1><p role={error ? 'alert' : 'status'}>{error || 'Connecting to the room server…'}</p><button onClick={backHome}>Back home</button></main>
    const problem = startProblem(room, scenario, draft)
    const members = roomMembers(room, isHost ? draft : {})

    return <>
        {summaryPreview ? <Summary members={roomMembers(room, {}, scenario)} roomCode={room.room_code} onBackToCall={returnToRoom} /> : room.phase !== 'lobby' ? <Game room={room} scenarios={scenarios} error={error} execute={execute} onLeaveRoom={requestLeave} leaveLabel={onLeaveDemo ? 'Leave demo' : 'Leave room'} /> : <MotionConfig reducedMotion="user">
        <div className="host-lobby">
            <header className="lobby-toolbar">
                <button className="lobby-leave-button" type="button" disabled={!onLeaveDemo && controlsDisabled} title={onLeaveDemo ? 'End the demo and return to the main menu' : isHost ? 'Close this lobby for everyone' : 'Leave this lobby and remove your seat'} onClick={requestLeave}>{onLeaveDemo ? 'Leave demo' : leaving ? 'Leaving…' : 'Leave'}</button>
                <RoomCodeButton key={room.room_code} code={room.room_code} />
                {isHost ? <DocumentUpload onUploadingChange={setIsDocumentUploading} roomCode={room.room_code} onContextChange={(context) => setDocumentNotice(`${context} This upload is not processed or used by the briefing.`)} /> : <span className="lobby-waiting">Waiting for the host</span>}
            </header>
            <main className="lobby-main" aria-labelledby="lobby-title">
                <h1 id="lobby-title" className="lobby-visually-hidden">{isHost ? 'Host' : 'Room'} lobby, {members.length} of {room.capacity} players</h1>
                <PlayerRoster members={members} editable={isHost && !controlsDisabled} renderName={(member) => member.id === room.self_member_id ? <LobbyNameEditor name={member.name} rename={rename} disabled={controlsDisabled} /> : member.name} roles={[{ id: 'unassigned', label: 'Choose a role' }, ...scenario?.roles.map((role) => ({ id: role.role_id, label: role.name })) ?? []]} onAssignRole={(memberId, role) => { setDraft((current) => ({ ...current, [memberId]: role })); setNotice('') }} />
            </main>
            <footer className="lobby-context">
                <div className="lobby-scenario-controls">
                    <div className="lobby-setting"><span>Scenario</span><RolePicker id="lobby-scenario" className="lobby-setting-picker" opaqueMenu ariaLabel="Scenario" disabled={!isHost || controlsDisabled} value={scenario ? `${scenario.scenario_id}:${scenario.version}` : ''} roles={scenarios.map((option) => ({ id: `${option.scenario_id}:${option.version}`, label: `${option.title} (v${option.version})` }))} onChange={(value) => { setSelectedScenario(value); setDraft({}); setSelectedTiming('') }} /></div>
                    <div className="lobby-setting"><span>Timing</span><RolePicker id="lobby-timing" className="lobby-setting-picker" opaqueMenu ariaLabel="Timing profile" disabled={!isHost || controlsDisabled} value={timing} roles={scenario?.timings.map((option) => ({ id: option.profile_id, label: `${option.profile_id.replaceAll('_', ' ')} (${option.briefing_seconds}s briefing)` })) ?? []} onChange={setSelectedTiming} /></div>
                </div>
                {isHost && <button className="lobby-start-button" type="button" disabled={controlsDisabled || Boolean(problem)} onClick={submitStart} title={problem ?? 'Start the server briefing'}>{starting ? 'Starting…' : 'Start'} <LobbyIcon name="play" /></button>}
                <p className="lobby-live-status" role="status">{isHost ? problem ?? 'Ready. Start assigns these roles to all participants.' : 'The host assigns roles when the room starts.'} {room.members.filter((member) => member.connected).length} active.</p>
                {(error || notice) && <p role={error ? 'alert' : 'status'}>{error || notice}</p>}
                <button className="room-text-button" type="button" disabled={controlsDisabled} onClick={showSummaryPreview}>Summary demo preview</button>
                <p id="room-context" title={documentNotice}><span>Upload:</span> {documentNotice} The selected scenario supplies the briefing.</p>
            </footer>
        </div>
    </MotionConfig>}
        {showChat && <RoomChat key={room.room_id} room={room} scenarios={scenarios} refreshRoom={refresh} />}
        {confirmLeave && <HostLeavePrompt onYes={confirmHostLeave} onNo={() => setConfirmLeave(false)} />}
    </>
}

export default Host
