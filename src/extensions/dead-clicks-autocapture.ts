import { PostHog } from '../posthog-core'
import { DEAD_CLICKS_ENABLED_SERVER_SIDE } from '../constants'
import { isBoolean } from '../utils/type-utils'
import { assignableWindow, document, LazyLoadedDeadClicksAutocapture } from '../utils/globals'
import { logger } from '../utils/logger'

const LOGGER_PREFIX = '[Dead Clicks]'

export class DeadClicksAutocapture {
    get lazyLoadedDeadClicksAutocapture(): LazyLoadedDeadClicksAutocapture | undefined {
        return this._lazyLoadedDeadClicksAutocapture
    }

    private _enabledServerSide: boolean
    private _lazyLoadedDeadClicksAutocapture: LazyLoadedDeadClicksAutocapture | undefined

    constructor(readonly instance: PostHog) {
        this._enabledServerSide = !!this.instance.persistence?.props[DEAD_CLICKS_ENABLED_SERVER_SIDE]
        this.startIfEnabled()
    }

    public get isEnabled(): boolean {
        const clientConfig = this.instance.config.capture_dead_clicks
        return isBoolean(clientConfig) ? clientConfig : this._enabledServerSide
    }

    public startIfEnabled() {
        if (this.isEnabled) {
            this.loadScript(this.start.bind(this))
        }
    }

    private loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.initDeadClicksAutocapture) {
            // already loaded
            cb()
        }
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(
            this.instance,
            'dead-clicks-autocapture',
            (err) => {
                if (err) {
                    logger.error(LOGGER_PREFIX + ' failed to load script', err)
                    return
                }
                cb()
            }
        )
    }

    private start() {
        if (!document) {
            logger.error(LOGGER_PREFIX + ' `document` not found. Cannot start.')
            return
        }

        if (
            !this._lazyLoadedDeadClicksAutocapture &&
            assignableWindow.__PosthogExtensions__?.initDeadClicksAutocapture
        ) {
            this._lazyLoadedDeadClicksAutocapture = assignableWindow.__PosthogExtensions__.initDeadClicksAutocapture(
                this.instance
            )
            this._lazyLoadedDeadClicksAutocapture.start(document)
            logger.info(`${LOGGER_PREFIX} starting...`)
        }
    }

    stop() {
        if (this._lazyLoadedDeadClicksAutocapture) {
            this._lazyLoadedDeadClicksAutocapture.stop()
            logger.info(`${LOGGER_PREFIX} stopping...`)
        }
    }
}
