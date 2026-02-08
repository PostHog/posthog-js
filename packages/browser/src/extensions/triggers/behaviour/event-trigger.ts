import type { PostHog } from '@posthog/types'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

export class EventTrigger implements Trigger {
    readonly name = 'event'
    readonly eventTriggers: string[]

    private readonly _options: TriggerOptions
    private readonly _persistence: PersistenceHelper
    private _initialized = false

    constructor(options: TriggerOptions, eventTriggers: string[]) {
        this._options = options
        this.eventTriggers = eventTriggers
        this._persistence = options.persistence.withPrefix('event')
    }

    init(): void {
        if (this._initialized) {
            return
        }
        this._initialized = true

        if (this.eventTriggers.length > 0) {
            this._setupEventListener(this._options.posthog)
        }
    }

    matches(sessionId: string): boolean | null {
        if (this.eventTriggers.length === 0) {
            return null
        }

        return this._persistence.isTriggered(sessionId)
    }

    private _setupEventListener(posthog: PostHog): void {
        posthog.on('eventCaptured', (event) => {
            if (!event?.event) {
                return
            }

            if (this.eventTriggers.includes(event.event)) {
                this._persistence.setTriggered(posthog.get_session_id())
            }
        })
    }
}
