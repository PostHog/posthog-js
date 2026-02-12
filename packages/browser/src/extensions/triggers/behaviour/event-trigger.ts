import type { PostHog } from '@posthog/types'
import type { Trigger, TriggerOptions } from './types'
import type { PersistenceHelper } from './persistence'

export class EventTrigger implements Trigger {
    readonly name = 'event'
    eventTriggers: string[] = []

    private readonly _posthog: PostHog
    private readonly _persistence: PersistenceHelper
    private _unsubscribe: (() => void) | null = null

    constructor(options: TriggerOptions) {
        this._posthog = options.posthog
        this._persistence = options.persistence.withPrefix('event')
    }

    init(eventTriggers: string[]): void {
        this.eventTriggers = eventTriggers

        this._unsubscribe?.()
        this._unsubscribe = null

        if (this.eventTriggers.length > 0) {
            this._unsubscribe = this._setupEventListener(this._posthog)
        }
    }

    matches(sessionId: string): boolean | null {
        if (this.eventTriggers.length === 0) {
            return null
        }

        return this._persistence.isTriggered(sessionId)
    }

    private _setupEventListener(posthog: PostHog): () => void {
        return posthog.on('eventCaptured', (event) => {
            if (!event?.event) {
                return
            }

            if (this.eventTriggers.includes(event.event)) {
                this._persistence.setTriggered(posthog.get_session_id())
            }
        })
    }
}
