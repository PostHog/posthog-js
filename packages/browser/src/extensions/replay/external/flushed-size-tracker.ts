import { isObject } from '@posthog/core'
import { PostHog } from '../../../posthog-core'

const SESSION_RECORDING_FLUSHED_SIZE = '$sess_rec_flush_size'

interface FlushedSize {
    sessionId: string
    size: number
}

function isFlushedSize(value: unknown): value is FlushedSize {
    return isObject(value) && 'sessionId' in value && 'size' in value
}

export class FlushedSizeTracker {
    private readonly _getProperty: (property_name: string) => unknown
    private readonly _setProperty: (prop: string, to: any) => void

    constructor(posthog: PostHog) {
        if (!posthog.persistence) {
            throw new Error('it is not valid to not have persistence and be this far into setting up the application')
        }

        this._getProperty = posthog.get_property.bind(posthog)
        this._setProperty = posthog.persistence.set_property.bind(posthog.persistence)
    }

    trackSize(sessionId: string, size: number) {
        this._setProperty(SESSION_RECORDING_FLUSHED_SIZE, {
            sessionId,
            size: this.currentTrackedSize(sessionId) + size,
        })
    }

    currentTrackedSize(sessionId: string): number {
        const stored = this._getProperty(SESSION_RECORDING_FLUSHED_SIZE)
        return isFlushedSize(stored) && stored.sessionId === sessionId ? stored.size : 0
    }
}
