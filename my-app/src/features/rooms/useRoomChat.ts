import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { roomApi } from './useRoom'
import { createChatStore } from './chatState'

/** One shared chat store per room: polls committed history and owns the draft, used by the lobby pill and the game drawer. */
export function useRoomChat(roomId: string, refreshRoom: () => Promise<void>) {
    const store = useMemo(() => createChatStore({ api: roomApi, roomId, refreshRoom }), [roomId, refreshRoom])
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
    useEffect(() => store.start((resume) => {
        const visible = () => { if (document.visibilityState === 'visible') resume() }
        window.addEventListener('focus', resume)
        document.addEventListener('visibilitychange', visible)
        return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', visible) }
    }), [store])
    return { store, state }
}

export type RoomChatHandle = ReturnType<typeof useRoomChat>
