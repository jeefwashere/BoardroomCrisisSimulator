import { useState } from 'react'
import '../App.css'
import BoardroomIcon from '../common/icons/BoardroomIcon'
import PlayerIcon from '../common/icons/PlayerIcon'
import Navbar from '../common/Navbar'

const briefings = [
    {
        category: 'Reputation',
        title: 'The leak is live.',
        description: 'An internal memo just became front-page news. Your team has to decide what happens next.',
        question: 'Speak up or stay silent?',
    },
    {
        category: 'Operations',
        title: 'The launch goes dark.',
        description: 'Your biggest launch is hours away. A critical system fails, and every option has a cost.',
        question: 'Delay the launch or take the risk?',
    },
    {
        category: 'Teamwork',
        title: 'The board is divided.',
        description: 'Two paths. Strong opinions. Your team needs a decision before disagreement becomes a crisis.',
        question: 'Find common ground or make the call?',
    },
]

function Home() {
    const [briefingIndex, setBriefingIndex] = useState(0)
    const briefing = briefings[briefingIndex]

    function changeBriefing(direction: number) {
        setBriefingIndex((index) => (index + direction + briefings.length) % briefings.length)
    }

    return (
        <div className="home">
            <Navbar />

            <main className="home-main">
                <section className="intro" aria-labelledby="home-title">
                    <span className="eyebrow"><span /> BIG DECISIONS. SHARED CONSEQUENCES.</span>
                    <h1 id="home-title">Boardroom<br /><em>Crisis</em> Simulator</h1>
                    <p className="intro-description">
                        A room full of opinions. A crisis with no easy answers.
                        Take your seat. The next move is yours.
                    </p>

                    <ul className="game-traits" aria-label="Game themes">
                        <li><span aria-hidden="true">◇</span> Strategy</li>
                        <li><PlayerIcon /> Teamwork</li>
                        <li><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m11.5 2-7 9H10l-1.5 7 7-10H10l1.5-6Z" /></svg> Tough calls</li>
                    </ul>

                    <div className="session-actions" aria-label="Session options">
                        {/* Connect these buttons to the session flows when they are added. */}
                        <button className="session-button host-button" type="button">
                            <span className="action-topline">
                                <span className="action-icon" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" fill="none"><path d="m4 7 4 4 4-7 4 7 4-4-2 11H6L4 7ZM7 21h10" /></svg>
                                </span>
                                <span className="action-kicker">TAKE THE LEAD</span>
                            </span>
                            <span className="action-heading">Host a session <span className="button-arrow" aria-hidden="true">↗</span></span>
                            <span className="action-description">Create the room. Set the stakes.</span>
                        </button>
                        <button className="session-button join-button" type="button">
                            <span className="action-topline">
                                <span className="action-icon" aria-hidden="true"><PlayerIcon /></span>
                                <span className="action-kicker">BACK YOUR TEAM</span>
                            </span>
                            <span className="action-heading">Join a session <span className="button-arrow" aria-hidden="true">↗</span></span>
                            <span className="action-description">Got a code? Pull up a chair.</span>
                        </button>
                    </div>
                    <p className="session-hint">Different perspectives. One team. Make it count.</p>
                </section>

                <aside className="game-preview" aria-label="A preview of the game">
                    <div className="preview-heading">
                        <span>THE BOARD IS SET</span>
                        <span className="preview-mark" aria-hidden="true">✳</span>
                    </div>

                    <div className="board-scene" aria-hidden="true">
                        <div className="board-orbit" />
                        <div className="board-table">
                            <span className="table-label">BOARDROOM</span>
                            <div className="table-cards">
                                <span className="table-card table-card-back"><BoardroomIcon /></span>
                                <span className="table-card table-card-front">!</span>
                            </div>
                            <span className="table-label table-label-bottom">EVERY MOVE MATTERS</span>
                        </div>
                        {[1, 2, 3, 4, 5, 6].map((seat) => (
                            <span key={seat} className={`player-seat player-seat-${seat}`}><PlayerIcon /></span>
                        ))}
                        <span className="your-seat">YOUR SEAT <span>↖</span></span>
                    </div>

                    <section className="briefing-deck" aria-label="Sample crisis briefings">
                        <div className="briefing-topline">
                            <span className="briefing-label"><span /> SAMPLE CRISIS</span>
                            <span className="briefing-count">0{briefingIndex + 1} <span>/ 0{briefings.length}</span></span>
                        </div>
                        <div className="briefing-content" aria-live="polite" aria-atomic="true">
                            <span className="briefing-category">{briefing.category}</span>
                            <h2>{briefing.title}</h2>
                            <p>{briefing.description}</p>
                            <p className="briefing-question">{briefing.question}</p>
                        </div>
                        <div className="briefing-controls">
                            <div className="deck-position" aria-hidden="true">
                                {briefings.map((item, index) => (
                                    <span key={item.title} className={index === briefingIndex ? 'is-active' : ''} />
                                ))}
                            </div>
                            <div className="deck-buttons">
                                <button type="button" className="deck-button" aria-label="Previous sample crisis" onClick={() => changeBriefing(-1)}>←</button>
                                <button type="button" className="deck-button" aria-label="Next sample crisis" onClick={() => changeBriefing(1)}>→</button>
                            </div>
                        </div>
                    </section>
                </aside>
            </main>

            <footer className="site-footer">
                <span>Good teams don’t always agree. They make the next move together.</span>
                <span className="footer-note"><span /> KEEP A COOL HEAD.</span>
            </footer>
        </div>
    )
}

export default Home
