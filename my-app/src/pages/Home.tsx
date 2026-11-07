import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Variants } from 'motion/react'
import HoverWaveText from '../common/HoverWaveText'
import EditableSessionName from '../features/identity/EditableSessionName'
import { useSessionName } from '../features/identity/useSessionName'
import './Home.css'

function Home() {
    const [roomCode, setRoomCode] = useState('')
    const { isMenuReady } = useSessionName()
    const reducedMotion = useReducedMotion() ?? false
    const optionVariants: Variants = {
        hidden: { opacity: 0, x: reducedMotion ? 0 : -48 },
        shown: { opacity: 1, x: 0, transition: reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 24, mass: 0.7 } },
    }

    return (
        <main className="home-menu">
            <EditableSessionName />
            <section className="home-menu__content" aria-labelledby="home-title" inert={!isMenuReady}>
                <h1 id="home-title" className="home-menu__title" aria-label="Boardroom Crisis Simulator">
                    <HoverWaveText text="Boardroom" entrance="below" visible={isMenuReady} />
                    <HoverWaveText text="Crisis Simulator" className="home-menu__subtitle" entrance="above" visible={isMenuReady} />
                </h1>

                <motion.div
                    className="home-menu__actions"
                    aria-label="Session options"
                    initial="hidden"
                    animate={isMenuReady ? 'shown' : 'hidden'}
                    variants={{ shown: { transition: { delayChildren: reducedMotion ? 0 : 0.45, staggerChildren: reducedMotion ? 0 : 0.12 } }, hidden: {} }}
                >
                    <motion.div variants={optionVariants}>
                        <button className="home-menu__button" type="button" onClick={() => { window.location.hash = '/host' }}>
                            Host
                            <span className="home-menu__arrow" aria-hidden="true">›</span>
                        </button>
                    </motion.div>

                    <motion.div className="home-menu__join" variants={optionVariants}>
                        <label className="home-menu__label" htmlFor="room-code">
                            Room code
                        </label>
                        <span className="home-menu__code-field">
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
                        </span>
                        <button
                            className="home-menu__button"
                            type="button"
                            disabled={!roomCode.trim()}
                        >
                            Join
                            <span className="home-menu__arrow" aria-hidden="true">›</span>
                        </button>
                    </motion.div>
                </motion.div>
            </section>
        </main>
    )
}

export default Home
