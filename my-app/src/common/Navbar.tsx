import BoardroomIcon from './icons/BoardroomIcon'

function Navbar() {
    return (
        <header className="site-header">
            <span className="brand">
                <span className="brand-icon"><BoardroomIcon /></span>
                <span>BOARDROOM<span className="brand-period">.</span></span>
            </span>
            <span className="header-caption">SHARED DECISIONS</span>
        </header>
    )
}

export default Navbar
