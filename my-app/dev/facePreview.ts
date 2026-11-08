// Dev only harness for face-preview.html: mounts the real 3D boardroom with a fake room state so
// the characters' facial expressions can be checked without a backend or a running game.
import { Boardroom } from '../src/features/boardroom3d/Boardroom'
import { boardroomView, type BoardMember, type StageAgent } from '../src/features/boardroom3d/boardroomModel'

const members: BoardMember[] = [
    { id: 'a', name: 'Alex', role: 'CEO', color: '#4c7bd9', connected: true },
    { id: 'm', name: 'Morgan', role: 'IT recovery lead', color: '#3aa37a', connected: true },
    { id: 's', name: 'Sam', role: 'Communications lead', color: '#c9733a', connected: true },
]
const agent: StageAgent = { kind: 'expert', name: 'IT adviser', role: 'AI expert', accent: '#5aa9e6' }
const params = new URLSearchParams(location.search)
const phase = document.querySelector<HTMLSelectElement>('#phase')!
const talker = document.querySelector<HTMLSelectElement>('#talker')!
phase.value = params.get('phase') ?? 'speaking'
talker.value = params.get('talker') ?? 'm'

const board = new Boardroom(document.querySelector<HTMLElement>('#stage')!)
;(window as Window & { __board3d?: Boardroom }).__board3d = board

function apply() {
    const who = talker.value
    const talking = new Set(who && who !== 'agent' ? [who] : [])
    const view = boardroomView({
        phase: phase.value, selfId: 'none', eligibleIds: ['a', 'm', 's'], activeSpeakerId: who && who !== 'agent' ? who : null,
        speakerIndex: 0, speakerCount: 9, scenarioTitle: 'T01 service outage',
    }, members, talking, who === 'agent' ? agent : null)
    board.update(view, { deadline: null, serverTime: null })
}
phase.onchange = apply
talker.onchange = apply
apply()
