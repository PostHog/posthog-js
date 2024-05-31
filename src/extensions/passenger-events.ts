import { PostHog } from '../posthog-core'
import { isBoolean } from '../utils/type-utils'
import { logger } from '../utils/logger'

export abstract class PassengerEvents<T> {
    _enabledServerSide: boolean = false
    _initialized = false

    // TODO: Periodically flush this if no other event has taken care of it
    protected buffer: T | undefined

    protected constructor(
        protected readonly instance: PostHog,
        protected readonly loggerKey: string,
        protected readonly readClientConfig: (p: PostHog) => boolean | undefined,
        persistenceKey: string
    ) {
        this._enabledServerSide = !!this.instance.persistence?.props[persistenceKey]
    }

    protected abstract onStart(): void

    public get isEnabled(): boolean {
        const clientConfig = this.readClientConfig(this.instance)
        return isBoolean(clientConfig) ? clientConfig : this._enabledServerSide
    }

    public startIfEnabled(): void {
        if (this.isEnabled && !this._initialized) {
            logger.info(`[${this.loggerKey}] enabled, starting...`)
            this.onStart()
        }
    }

    public getAndClearBuffer(): T | undefined {
        const buffer = this.buffer
        this.buffer = undefined
        return buffer
    }
}
