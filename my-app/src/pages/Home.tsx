import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Variants } from 'motion/react'
import HoverWaveText from '../common/HoverWaveText'
import EditableSessionName from '../features/identity/EditableSessionName'
import { useSessionName } from '../features/identity/useSessionName'
import { useRoomEntry } from '../features/rooms/useRoomEntry'
import DemoEntryButton from '../features/demo/DemoEntryButton'
import type { EntryMode } from '../features/rooms/directEntry'
import type { RoomSnapshot } from '../services/rooms'
import './Home.css'

type HomeProps = { initialEntry?: EntryMode; initialCode?: string; onEnter: (room: RoomSnapshot) => void }

function Home({ initialEntry, initialCode = '', onEnter }: HomeProps) {
    const [roomCode, setRoomCode] = useState(initialCode.toUpperCase())
    const { name, isMenuReady } = useSessionName()
    const entry = useRoomEntry({ name, roomCode, ready: isMenuReady, initialEntry, onEnter })
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
                        <button className="home-menu__button" type="button" disabled={Boolean(entry.busy) || !name} aria-busy={entry.busy === 'host'} onClick={() => void entry.submit('host')}>
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
                                maxLength={6}
                                disabled={Boolean(entry.busy)}
                                value={roomCode}
                                onChange={(event) => { setRoomCode(event.target.value.toUpperCase()); entry.clearError() }}
                                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void entry.submit('join') } }}
                            />
                        </span>
                        <button
                            className="home-menu__button"
                            type="button"
                            disabled={!roomCode.trim() || Boolean(entry.busy) || !name}
                            aria-busy={entry.busy === 'join'}
                            onClick={() => void entry.submit('join')}
                        >
                            Join
                            <span className="home-menu__arrow" aria-hidden="true">›</span>
                        </button>
                    </motion.div>

                    <motion.div variants={optionVariants}>
                        <DemoEntryButton disabled={Boolean(entry.busy)} />
                    </motion.div>
                </motion.div>
                {entry.needsRole && <div className="home-menu__late-role">
                    <label htmlFor="join-role">This game has started. Choose a role to join.</label>
                    <select id="join-role" value={entry.role} disabled={Boolean(entry.busy)} onChange={(event) => entry.setRole(event.target.value)}>
                        <option value="">Choose a role</option>
                        {entry.roles.map((option) => <option key={option.role_id} value={option.role_id}>{option.name}</option>)}
                    </select>
                </div>}
                {entry.error && <p className="home-menu__entry-error" role="alert">{entry.error}</p>}
                <p className="home-menu__entry-status" role="status">{entry.busy === 'host' ? 'Creating your room…' : entry.busy === 'join' ? 'Joining the room…' : ''}</p>
            </section>
        </main>
    )
}

export default Home
