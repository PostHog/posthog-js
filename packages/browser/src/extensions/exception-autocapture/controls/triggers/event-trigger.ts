import type { PostHog } from '@posthog/types'
import type { Trigger, LogFn, GetPersistedSessionId, SetPersistedSessionId } from './types'

export interface EventTriggerOptions {
    readonly posthog: PostHog
    readonly log: LogFn
    readonly getPersistedSessionId?: GetPersistedSessionId
    readonly setPersistedSessionId?: SetPersistedSessionId
}

export class EventTrigger implements Trigger {
    readonly name = 'event'

    private _posthog: PostHog | null = null
    private _eventTriggers: string[] = []
    private _matchedEventInSession: boolean = false
    private _initialized: boolean = false
    private _unsubscribe: (() => void) | null = null
    private _getPersistedSessionId: GetPersistedSessionId | undefined
    private _setPersistedSessionId: SetPersistedSessionId | undefined

    init(eventTriggers: string[], options: EventTriggerOptions): void {
        if (this._initialized) {
            this._teardownEventListener()
        }

        this._posthog = options.posthog
        this._eventTriggers = eventTriggers
        this._matchedEventInSession = false
        this._getPersistedSessionId = options.getPersistedSessionId
        this._setPersistedSessionId = options.setPersistedSessionId

        if (this._eventTriggers.length > 0) {
            this._setupEventListener()
        }

        this._initialized = true
    }

    matches(sessionId: string): boolean | null {
        if (this._eventTriggers.length === 0) {
            return null
        }

        // Check if already triggered for this session (from persistence)
        const persistedSessionId = this._getPersistedSessionId?.()
        if (persistedSessionId === sessionId) {
            return true
        }

        // Check if we matched an event in this session (in-memory)
        if (this._matchedEventInSession) {
            this._setPersistedSessionId?.(sessionId)
            return true
        }

        return false
    }

    private _setupEventListener(): void {
        const posthog = this._posthog
        if (!posthog) {
            return
        }

        this._unsubscribe = posthog.on('eventCaptured', (event) => {
            if (this._matchedEventInSession) {
                return // Already matched
            }

            if (!event?.event || this._eventTriggers.length === 0) {
                return
            }

            if (this._eventTriggers.includes(event.event)) {
                this._matchedEventInSession = true
            }
        })
    }

    private _teardownEventListener(): void {
        if (this._unsubscribe) {
            this._unsubscribe()
            this._unsubscribe = null
        }
    }
}
