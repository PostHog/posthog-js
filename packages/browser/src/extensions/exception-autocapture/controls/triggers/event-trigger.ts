import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

export class EventTrigger implements Trigger {
    readonly name = 'event'

    private readonly _eventTriggers: string[]
    private readonly _persistence: PersistenceHelper

    private _matchedEventInSession: boolean = false

    constructor(options: TriggerOptions, eventTriggers: string[]) {
        this._eventTriggers = eventTriggers
        this._persistence = options.persistenceHelperFactory.create('event')

        if (this._eventTriggers.length > 0) {
            this._setupEventListener(options)
        }
    }

    matches(sessionId: string): boolean | null {
        if (this._eventTriggers.length === 0) {
            return null
        }

        // Check if already triggered for this session (from persistence)
        if (this._persistence.sessionMatchesTrigger(sessionId)) {
            return true
        }

        // Check if we matched an event in this session (in-memory)
        if (this._matchedEventInSession) {
            this._persistence.matchTriggerInSession(sessionId)
            return true
        }

        return false
    }

    private _setupEventListener(options: TriggerOptions): void {
        options.posthog.on('eventCaptured', (event) => {
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
}
