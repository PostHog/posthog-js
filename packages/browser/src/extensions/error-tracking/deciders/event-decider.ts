import type { Decider, DeciderContext } from './types'

/**
 * Event Decider - listens for trigger events.
 *
 * When a configured trigger event is captured, sets internal state to allow capture.
 */
export class EventDecider implements Decider {
    readonly name = 'event'

    private _context: DeciderContext | null = null
    private _eventTriggers: string[] = []
    private _triggered: boolean = false

    init(context: DeciderContext): void {
        this._context = context
        this._eventTriggers = context.config.errorTracking?.event_triggers ?? []

        if (this._eventTriggers.length > 0) {
            this._setupEventListener()
            this._log('Initialized', { triggers: this._eventTriggers })
        }
    }

    shouldCapture(): boolean | null {
        if (this._eventTriggers.length === 0) {
            return null
        }
        return this._triggered
    }

    private _log(message: string, data?: Record<string, unknown>): void {
        this._context?.log(`[${this.name}] ${message}`, data)
    }

    private _setupEventListener(): void {
        const posthog = this._context?.posthog
        if (!posthog) {
            return
        }

        posthog.on('eventCaptured', (event) => {
            if (!event?.event || this._eventTriggers.length === 0) {
                return
            }

            if (this._eventTriggers.includes(event.event)) {
                this._triggered = true
                this._log('Trigger event captured', { event: event.event })
            }
        })
    }
}
