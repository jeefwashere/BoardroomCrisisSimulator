import '../App.css'

function BoardroomIcon() {
    return (
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect x="10" y="5" width="12" height="22" rx="5" />
            <path d="M5 9v4m0 6v4M27 9v4m0 6v4M14 1h4m-4 30h4" />
        </svg>
    )
}

function Home() {
    return (
        <div className="home">
            <header className="site-header">
                <a className="brand" href="./" aria-label="Boardroom home">
                    <span className="brand-icon"><BoardroomIcon /></span>
                    <span>BOARDROOM<span className="brand-period">.</span></span>
                </a>
                <span className="header-caption">A CRISIS SIMULATOR</span>
            </header>

            <main className="home-main">
                <div className="intro">
                    <span className="eyebrow"><span /> THINK FAST. LEAD TOGETHER.</span>
                    <h1>Boardroom<br /><em>Crisis</em> Simulator</h1>
                    <p className="intro-description">
                        The stakes are high. The next move is yours.<br />
                        Take a seat and put your decisions to the test.
                    </p>

                    <div className="session-actions" aria-label="Session options">
                        {/* Connect these buttons to the session flows when they are added. */}
                        <button className="session-button host-button" type="button">
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            Host a session
                            <span className="button-arrow" aria-hidden="true">↗</span>
                        </button>
                        <button className="session-button join-button" type="button">
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M14 8V5a1 1 0 0 1 1-1h5v16h-5a1 1 0 0 1-1-1v-3M3 12h12m-4-4 4 4-4 4" />
                            </svg>
                            Join a session
                            <span className="button-arrow" aria-hidden="true">↗</span>
                        </button>
                    </div>
                    <p className="session-hint">Start a new room, or join with a session code.</p>
                </div>

                <div className="table-caption" aria-hidden="true">
                    <span className="caption-line" />
                    <BoardroomIcon />
                    <span className="caption-line" />
                </div>
            </main>

            <footer className="site-footer">
                <span>One room. Different perspectives. Shared consequences.</span>
                <span className="footer-note"><span /> KEEP A COOL HEAD.</span>
            </footer>
        </div>
    )
}

export default Home