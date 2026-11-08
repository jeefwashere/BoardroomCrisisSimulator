import { createFacilitationApi } from '../../services/facilitation'
import { roomApi } from '../rooms/useRoom'

export const facilitationApi = createFacilitationApi(roomApi)

export function facilitationErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
        if (error.name === 'TypeError') return 'The facilitation service could not be reached. Check the connection and try again.'
        return error.message
    }
    return fallback
}
