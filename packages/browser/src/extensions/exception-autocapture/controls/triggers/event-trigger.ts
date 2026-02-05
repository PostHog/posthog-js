import type { PostHog } from '@posthog/types'
import type { Trigger, EventTriggerOptions } from './types'

export class EventTrigger implements Trigger {
    readonly name = 'event'

    private _posthog: PostHog | null = null
    private _eventTriggers: string[] = []
    private _triggered: boolean = false

    init(eventTriggers: string[], options: EventTriggerOptions): void {
        this._posthog = options.posthog
        this._eventTriggers = eventTriggers

        if (this._eventTriggers.length > 0) {
            this._setupEventListener()
        }
    }

    shouldCapture(): boolean | null {
        if (this._eventTriggers.length === 0) {
            return null
        }
        return this._triggered
    }

    private _setupEventListener(): void {
        const posthog = this._posthog
        if (!posthog) {
            return
        }

        posthog.on('eventCaptured', (event) => {
            if (!event?.event || this._eventTriggers.length === 0) {
                return
            }

            if (this._eventTriggers.includes(event.event)) {
                this._triggered = true
            }
        })
    }
}
