// Dev only harness for face-preview.html: mounts the real 3D boardroom with a fake room state so the characters'
// facial expressions can be checked without a backend or a running game. With "Round 3 quiz" on, the real quiz card
// sits over the scene with fake questions; each pick closes the question like the server would, so the result
// colour, sound and your own character's reaction run through the same code as in the game.
import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Boardroom3D from '../src/features/boardroom3d/Boardroom3D'
import { boardroomView, type BoardMember, type StageAgent } from '../src/features/boardroom3d/boardroomModel'
import { QuizStage } from '../src/features/game/PrivateQuiz'
import type { PrivateQuiz, QuizQuestion } from '../src/services/facilitation'
import '../src/index.css'
import '../src/pages/Game.css'
import '../src/pages/GameTheme.css'

const members: BoardMember[] = [
    { id: 'a', name: 'Alex', role: 'CEO', color: '#4c7bd9', connected: true },
    { id: 'm', name: 'Morgan', role: 'IT recovery lead', color: '#3aa37a', connected: true },
    { id: 's', name: 'Sam', role: 'Communications lead', color: '#c9733a', connected: true },
]
const agent: StageAgent = { kind: 'expert', name: 'IT adviser', role: 'AI expert', accent: '#5aa9e6' }
const params = new URLSearchParams(location.search)
/** Points per choice in the fake quiz: A is wrong, B the best, C and D partly right. */
const POINTS: Record<string, number> = { a: 0, b: 20, c: 10, d: 5 }

function question(step: number): QuizQuestion {
    return {
        step, question: `Question ${step}: the outage has lasted two hours. What do you tell the press first?`,
        choices: [
            { choice_id: 'a', text: 'Nothing until the cause is known (0 points)' },
            { choice_id: 'b', text: 'What is affected, what you are doing and when you will update next (20 points)' },
            { choice_id: 'c', text: 'An apology with no details yet (10 points)' },
            { choice_id: 'd', text: 'Refer every question to IT (5 points)' },
        ],
        chosen: null, points: null, max: 20, deadline: new Date(Date.now() + 60_000).toISOString(), timed_out: false,
    }
}

function freshQuiz(): PrivateQuiz {
    return { status: 'ready', current: 1, questions: [question(1)], total: 0, max: 100, question_seconds: 60, server_time: new Date().toISOString(), review: null }
}

export function Preview() {
    const [phase, setPhase] = useState(params.get('phase') ?? 'speaking')
    const [talker, setTalker] = useState(params.get('talker') ?? 'm')
    const [self, setSelf] = useState(params.get('self') ?? 'a')
    const [quiz, setQuiz] = useState<PrivateQuiz | null>(params.has('quiz') ? freshQuiz() : null)
    const quizPhase = quiz ? 'private_session' : phase
    const view = useMemo(() => {
        const talking = new Set(!quiz && talker && talker !== 'agent' ? [talker] : [])
        return boardroomView({
            phase: quizPhase, selfId: self, eligibleIds: ['a', 'm', 's'], activeSpeakerId: !quiz && talker && talker !== 'agent' ? talker : null,
            speakerIndex: 0, speakerCount: 9, scenarioTitle: 'T01 service outage',
        }, members, talking, !quiz && talker === 'agent' ? agent : null)
    }, [quiz, quizPhase, talker, self])
    const clock = useMemo(() => ({ deadline: null, serverTime: null }), [])

    const choose = async (step: number, choiceId: string) => {
        setQuiz((current) => {
            if (!current) return current
            const points = POINTS[choiceId] ?? 0
            const questions = current.questions.map((item) => item.step === step ? { ...item, chosen: choiceId, points } : item)
            const next = step < 5 ? step + 1 : null
            return {
                ...current, current: next, total: current.total + points, server_time: new Date().toISOString(),
                questions: next ? [...questions, question(next)] : questions,
            }
        })
        return true
    }

    return <div className="game-call-screen game-live-screen" style={{ position: 'absolute', inset: 0, display: 'flex' }}>
        <main className="game-call-main game-live-main game-live-main--3d" style={{ flex: 1, height: '100%', display: 'grid' }}>
            <Boardroom3D active view={view} clock={clock} />
            {quiz && <section className="call-stage private-call is-examiner">
                <QuizStage quiz={quiz} blocked={false} agentName="Crisis coach" retryable={false} onChoose={choose} onRetry={async () => true} />
            </section>}
        </main>
        <div id="panel">
            <h1>Faces preview</h1>
            <label htmlFor="phase">Phase</label>
            <select id="phase" value={phase} disabled={Boolean(quiz)} onChange={(event) => setPhase(event.target.value)}>
                {['speaking', 'lobby', 'briefing', 'discussion', 'individual_decision', 'voting', 'ended'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <label htmlFor="talker">Who is talking</label>
            <select id="talker" value={talker} disabled={Boolean(quiz)} onChange={(event) => setTalker(event.target.value)}>
                <option value="">nobody</option>
                <option value="a">Alex (01-coo)</option>
                <option value="m">Morgan (03-cto)</option>
                <option value="s">Sam (02-cfo)</option>
                <option value="agent">AI agent at the hub</option>
            </select>
            <label htmlFor="self">You are</label>
            <select id="self" value={self} onChange={(event) => setSelf(event.target.value)}>
                <option value="a">Alex (01-coo)</option>
                <option value="m">Morgan (03-cto)</option>
                <option value="s">Sam (02-cfo)</option>
            </select>
            <button type="button" onClick={() => setQuiz(quiz ? null : freshQuiz())}>{quiz ? 'Leave the quiz' : 'Round 3 quiz'}</button>
            <p>Dev only page: the real 3D scene with a fake room state, no backend. In the quiz, A is wrong (frown), B is the best answer (smile), C and D are partly right.</p>
        </div>
    </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)
