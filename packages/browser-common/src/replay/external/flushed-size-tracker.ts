import { isNumber, isObject, isString } from '@posthog/core'
import { SESSION_RECORDING_FLUSHED_SIZE } from '../constants'
import type { Client } from '../../index'

interface FlushedSize {
    sessionId: string
    size: number
}

function isFlushedSize(value: unknown): value is FlushedSize {
    return isObject(value) && isString((value as FlushedSize).sessionId) && isNumber((value as FlushedSize).size)
}

export class FlushedSizeTracker {
    private readonly _setProperty: (value: { sessionId: string; size: number }) => void

    constructor(
        private readonly _client: Pick<Client, 'kv'>,
        createWriter: () => (value: FlushedSize) => void
    ) {
        this._setProperty = createWriter()
    }

    trackSize(sessionId: string, size: number) {
        this._setProperty({
            sessionId,
            size: this.currentTrackedSize(sessionId) + size,
        })
    }

    currentTrackedSize(sessionId: string): number {
        const stored = this._client.kv.get(SESSION_RECORDING_FLUSHED_SIZE)
        return isFlushedSize(stored) && stored.sessionId === sessionId ? stored.size : 0
    }
}
