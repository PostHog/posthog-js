import type { Decider, DeciderContext } from './types'

export class EventDecider implements Decider {
    readonly name = 'event'

    private _context: DeciderContext | null = null
    private _eventTriggers: string[] = []
    private _triggered: boolean = false

    init(context: DeciderContext): void {
        this._context = context
        this._eventTriggers = context.config?.eventTriggers ?? []

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
            }
        })
    }
}
