import { useState } from 'react'
import HoverWaveText from '../common/HoverWaveText'
import EditableSessionName from '../features/identity/EditableSessionName'
import './Home.css'

function Home() {
    const [roomCode, setRoomCode] = useState('')

    return (
        <main className="home-menu">
            <EditableSessionName />
            <section className="home-menu__content" aria-labelledby="home-title">
                <h1 id="home-title" className="home-menu__title" aria-label="Boardroom Crisis Simulator">
                    <HoverWaveText text="Boardroom" />
                    <HoverWaveText text="Crisis Simulator" className="home-menu__subtitle" />
                </h1>

                <div className="home-menu__actions" aria-label="Session options">
                    <button className="home-menu__button" type="button" onClick={() => { window.location.hash = '/host' }}>
                        Host
                        <span className="home-menu__arrow" aria-hidden="true">›</span>
                    </button>

                    <div className="home-menu__join">
                        <label className="home-menu__label" htmlFor="room-code">
                            Room code
                        </label>
                        <input
                            className="home-menu__input"
                            id="room-code"
                            name="roomCode"
                            type="text"
                            placeholder="Enter code"
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            value={roomCode}
                            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                        />
                        <button
                            className="home-menu__button"
                            type="button"
                            disabled={!roomCode.trim()}
                            onClick={() => { window.location.hash = `/join?code=${encodeURIComponent(roomCode.trim())}` }}
                        >
                            Join
                            <span className="home-menu__arrow" aria-hidden="true">›</span>
                        </button>
                    </div>
                </div>
            </section>
        </main>
    )
}

export default Home
