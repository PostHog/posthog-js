import type { PostHog } from '@posthog/types'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

export class EventTrigger implements Trigger {
    readonly name = 'event'

    private readonly _eventTriggers: string[]
    private readonly _persistence: PersistenceHelper

    constructor(options: TriggerOptions, eventTriggers: string[]) {
        this._eventTriggers = eventTriggers
        this._persistence = options.persistence.withPrefix('event')

        if (this._eventTriggers.length > 0) {
            this._setupEventListener(options.posthog)
        }
    }

    matches(sessionId: string): boolean | null {
        if (this._eventTriggers.length === 0) {
            return null
        }

        return this._persistence.sessionMatchesTrigger(sessionId) ? true : false
    }

    private _setupEventListener(posthog: PostHog): void {
        posthog.on('eventCaptured', (event) => {
            if (!event?.event) {
                return
            }

            if (this._eventTriggers.includes(event.event)) {
                this._persistence.matchTriggerInSession(posthog.get_session_id())
            }
        })
    }
}
