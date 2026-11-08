import type { SessionClosure } from './sessionClosure'
import { sessionClosureMessage } from './sessionClosure'
import '../../pages/Home.css'
import './SessionClosure.css'

export default function SessionEnded({ reason, onBack }: { reason: SessionClosure; onBack: () => void }) {
    return <main className="home-menu session-ended">
        <section className="home-menu__content" aria-labelledby="session-ended-title">
            <h1 className="session-ended__title" id="session-ended-title">{reason === 'host_disconnected' ? 'Host disconnected' : 'Session ended'}</h1>
            <p className="session-ended__message" role="status">{sessionClosureMessage(reason)}</p>
            <div className="session-ended__actions"><button className="home-menu__button" type="button" onClick={onBack}>Main menu<span className="home-menu__arrow" aria-hidden="true">›</span></button></div>
        </section>
    </main>
}
