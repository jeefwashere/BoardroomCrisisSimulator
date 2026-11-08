import { useRef, useState } from 'react'
import { MotionConfig } from 'motion/react'
import PlayerRoster from '../features/lobby/PlayerRoster'
import ScenarioBrief from '../features/lobby/ScenarioBrief'
import { SCENARIO_BRIEF } from '../features/lobby/scenarioBriefModel'
import { pickDemoScenario } from '../features/demo/demoModel'
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
import { useRoomChat } from '../features/rooms/useRoomChat'
import './Host.css'

function Host({ roomId, initialRoom }: { roomId: string; initialRoom?: RoomSnapshot }) {
    const { room, scenarios, error, accessError, starting, leaving, start, leave, rename, execute, refresh } = useRoom(roomId, initialRoom)
    const chat = useRoomChat(roomId, refresh, room?.phase === 'ended')
    const [draft, setDraft] = useState<RoleDraft>({})
    const [selectedTiming, setSelectedTiming] = useState('')
    const [notice, setNotice] = useState('')
    const summaryPreview = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('preview') === 'summary'
    function showSummaryPreview() { window.location.hash = `/room/${roomId}?preview=summary` }
    function returnToRoom() { window.location.hash = `/room/${roomId}` }
    const startIntentRef = useRef<{ key: string; body: StartRoomInput } | null>(null)
    // We run one scenario (T01 Cedar Bridge); its brief is loaded automatically, so there is no picker or upload.
    const scenario = pickDemoScenario(scenarios)
    const timing = scenario?.timings.find((option) => option.profile_id === selectedTiming)?.profile_id ?? scenario?.timings[0]?.profile_id ?? ''
    const isHost = room?.self_member_id === room?.host_member_id
    const controlsDisabled = starting || leaving

    async function leaveLobby() {
        try { await leave(); window.location.hash = '/' }
        catch (failure) { setNotice(failure instanceof Error ? failure.message : 'The lobby could not be left. Please try again.') }
    }

    async function copyRoomCode() {
        if (!room) return
        try { await navigator.clipboard.writeText(room.room_code); setNotice('Room code copied.') }
        catch { setNotice(`Your room code is ${room.room_code}.`) }
    }

    /** Invite: a link that opens the home page with this room's code and joins straight away (3 to 10 players). */
    async function invite() {
        if (!room) return
        const link = `${window.location.origin}${window.location.pathname}#/join?code=${room.room_code}`
        const text = `Join my boardroom crisis game. Room code ${room.room_code}.`
        try {
            if (navigator.share && window.matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: 'Boardroom Crisis Simulator', text, url: link }); return }
            await navigator.clipboard.writeText(link)
            setNotice(`Invite link copied. Share it with up to ${room.capacity - room.members.length} more players.`)
        } catch (failure) {
            if (failure instanceof DOMException && failure.name === 'AbortError') return
            setNotice(`Invite link: ${link}`)
        }
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

    if (accessError) return <main className="room-loading"><h1>{accessError.code === 'room_closed' ? 'Room closed' : 'Room unavailable'}</h1><p role="alert">{accessError.message}</p><button className="room-text-button" type="button" onClick={() => { window.location.hash = '/' }}>Back home</button></main>
    if (!room) return <main className="room-loading"><h1>Opening boardroom</h1><p role={error ? 'alert' : 'status'}>{error || 'Connecting to the room server…'}</p><button onClick={() => { window.location.hash = '/' }}>Back home</button></main>
    const problem = startProblem(room, scenario, draft)
    const members = roomMembers(room, isHost ? draft : {})

    return <>
        {summaryPreview ? <Summary members={roomMembers(room, {}, scenario)} roomCode={room.room_code} onBackToCall={returnToRoom} /> : room.phase !== 'lobby' ? <Game room={room} scenarios={scenarios} error={error} rename={rename} execute={execute} onViewSummary={showSummaryPreview} chat={chat} leave={leave} /> : <MotionConfig reducedMotion="user">
        <div className="host-lobby">
            <header className="lobby-toolbar">
                <button className="lobby-leave-button" type="button" disabled={controlsDisabled} title={isHost ? 'Close this lobby for everyone' : 'Leave this lobby and remove your seat'} onClick={() => void leaveLobby()}>{leaving ? 'Leaving…' : 'Leave'}</button>
                <div className="lobby-code-group">
                    <button className="lobby-room-code" type="button" onClick={() => void copyRoomCode()} aria-label={`Copy room code ${room.room_code}`} title="Copy room code"><span>Room code</span><strong>{room.room_code}</strong></button>
                    <button className="lobby-invite-button" type="button" disabled={members.length >= room.capacity} onClick={() => void invite()} title={members.length >= room.capacity ? 'The room is full (10 players).' : 'Copy an invite link for this room'}><LobbyIcon name="invite" /><span>Invite</span></button>
                </div>
                <div className="lobby-document-upload">{!isHost && <span className="lobby-waiting">Waiting for the host</span>}<ScenarioBrief /></div>
            </header>
            <main className="lobby-main" aria-labelledby="lobby-title">
                <h1 id="lobby-title" className="lobby-visually-hidden">{isHost ? 'Host' : 'Room'} lobby, {members.length} of {room.capacity} players</h1>
                <PlayerRoster members={members} editable={isHost && !controlsDisabled} renderName={(member) => member.id === room.self_member_id ? <LobbyNameEditor name={member.name} rename={rename} disabled={controlsDisabled} /> : member.name} roles={[{ id: 'unassigned', label: 'Choose a role' }, ...scenario?.roles.map((role) => ({ id: role.role_id, label: role.name })) ?? []]} onAssignRole={(memberId, role) => { setDraft((current) => ({ ...current, [memberId]: role })); setNotice('') }} />
            </main>
            <footer className="lobby-context">
                <div className="lobby-scenario-controls">
                    <div className="lobby-setting"><span>Scenario</span><strong className="lobby-scenario-fixed" title={scenario?.title}>{scenario ? scenario.title : 'Loading…'}</strong></div>
                    <div className="lobby-setting"><span>Timing</span><RolePicker id="lobby-timing" className="lobby-setting-picker" opaqueMenu ariaLabel="Timing profile" disabled={!isHost || controlsDisabled} value={timing} roles={scenario?.timings.map((option) => ({ id: option.profile_id, label: `${option.profile_id.replaceAll('_', ' ')} (${option.briefing_seconds}s briefing)` })) ?? []} onChange={setSelectedTiming} /></div>
                </div>
                {isHost && <button className="lobby-start-button" type="button" disabled={controlsDisabled || Boolean(problem)} onClick={submitStart} title={problem ?? 'Start the server briefing'}>{starting ? 'Starting…' : 'Start'} <LobbyIcon name="play" /></button>}
                <p className="lobby-live-status" role="status">{isHost ? problem ?? 'Ready. Start assigns these roles to all participants.' : 'The host assigns roles when the room starts.'} {members.length} of {room.capacity} players ({room.members.filter((member) => member.connected).length} active; 3 to {room.capacity} can play).</p>
                {(error || notice) && <p role={error ? 'alert' : 'status'}>{error || notice}</p>}
                <button className="room-text-button" type="button" disabled={controlsDisabled} onClick={showSummaryPreview}>Summary demo preview</button>
                <p id="room-context"><span>Brief:</span> {SCENARIO_BRIEF.title} (T01) is loaded automatically for everyone in the room.</p>
            </footer>
        </div>
    </MotionConfig>}
        {(summaryPreview || room.phase === 'lobby') && <RoomChat room={room} scenarios={scenarios} chat={chat} />}
    </>
}

export default Host
