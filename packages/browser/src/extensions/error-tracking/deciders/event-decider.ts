import type { RemoteConfig } from '../../../types'
import type { Decider, DeciderContext, DeciderResult } from './types'

/**
 * Callback type for when the event decider triggers.
 */
export type EventTriggerCallback = () => void

/**
 * Event Decider - handles event-based ingestion control.
 *
 * Logic:
 * - Hooks into PostHog's event capture system
 * - When a trigger event is captured, calls the provided callback
 * - This allows coordination with other deciders (e.g., unblock URL decider)
 */
export class EventDecider implements Decider {
    readonly name = 'event'

    private _context: DeciderContext | null = null
    private _eventTriggers: string[] = []
    private _onTrigger: EventTriggerCallback | null = null
    private _unsubscribe: (() => void) | null = null

    /**
     * Set a callback to be called when a trigger event is captured.
     * This allows coordination with other deciders.
     */
    setTriggerCallback(callback: EventTriggerCallback): void {
        this._onTrigger = callback
    }

    init(context: DeciderContext, config: RemoteConfig): void {
        this._context = context
        this._eventTriggers = config.errorTracking?.event_triggers ?? []

        if (this._eventTriggers.length > 0) {
            this._setupEventListener()
            this._log('Initialized', { triggers: this._eventTriggers })
        }
    }

    evaluate(): DeciderResult | null {
        // Event decider doesn't block on its own - it only triggers unblocking
        // Return null to indicate no opinion
        return null
    }

    shutdown(): void {
        this._unsubscribe?.()
        this._unsubscribe = null
        this._onTrigger = null
    }

    private _setupEventListener(): void {
        this._unsubscribe?.()

        const posthog = this._context?.posthog
        if (!posthog) {
            return
        }

        this._unsubscribe = posthog.on('eventCaptured', (event) => {
            if (!event?.event) {
                return
            }
            this._onEventCaptured(event.event)
        })
    }

    private _onEventCaptured(eventName: string): void {
        if (this._eventTriggers.length === 0) {
            return
        }

        const matches = this._eventTriggers.includes(eventName)
        if (matches) {
            this._log('Trigger event captured', {
                event: eventName,
                configuredTriggers: this._eventTriggers,
            })

            this._onTrigger?.()
        }
    }

    private _log(message: string, data?: Record<string, unknown>): void {
        this._context?.log(`[${this.name}] ${message}`, data)
    }
}
