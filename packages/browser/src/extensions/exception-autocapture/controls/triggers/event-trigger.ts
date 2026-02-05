import type { PostHog } from '@posthog/types'
import type { Trigger, LogFn } from './types'

export interface EventTriggerOptions {
    readonly posthog: PostHog
    readonly log: LogFn
}

export class EventTrigger implements Trigger {
    readonly name = 'event'

    private _posthog: PostHog | null = null
    private _eventTriggers: string[] = []
    private _triggered: boolean = false
    private _initialized: boolean = false
    private _unsubscribe: (() => void) | null = null

    init(eventTriggers: string[], options: EventTriggerOptions): void {
        if (this._initialized) {
            this._teardownEventListener()
        }

        this._posthog = options.posthog
        this._eventTriggers = eventTriggers
        this._triggered = false

        if (this._eventTriggers.length > 0) {
            this._setupEventListener()
        }

        this._initialized = true
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

        this._unsubscribe = posthog.on('eventCaptured', (event) => {
            if (!event?.event || this._eventTriggers.length === 0) {
                return
            }

            if (this._eventTriggers.includes(event.event)) {
                this._triggered = true
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
