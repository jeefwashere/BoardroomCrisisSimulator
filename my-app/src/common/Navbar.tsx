import '../App.css'
import { BoardroomIcon } from './icons'

function Navbar() {
    return (
        <header className="site-header">
            <a className="brand" href="./" aria-label="Boardroom home">
                <span className="brand-icon"><BoardroomIcon /></span>
                <span>BOARDROOM<span className="brand-period">.</span></span>
            </a>
            <span className="header-caption"><span className="lobby-dot" /> THE LOBBY</span>
        </header>
    )
}

export default Navbar