import { PostHog } from '../posthog-core'
import { DEAD_CLICKS_ENABLED_SERVER_SIDE } from '../constants'
import { isBoolean, isObject } from '../utils/type-utils'
import { assignableWindow, document, LazyLoadedDeadClicksAutocaptureInterface } from '../utils/globals'
import { logger } from '../utils/logger'
import { DecideResponse } from '../types'

const LOGGER_PREFIX = '[Dead Clicks]'

export class DeadClicksAutocapture {
    get lazyLoadedDeadClicksAutocapture(): LazyLoadedDeadClicksAutocaptureInterface | undefined {
        return this._lazyLoadedDeadClicksAutocapture
    }

    private _lazyLoadedDeadClicksAutocapture: LazyLoadedDeadClicksAutocaptureInterface | undefined

    constructor(readonly instance: PostHog) {
        this.startIfEnabled()
    }

    public get isRemoteEnabled(): boolean {
        return !!this.instance.persistence?.get_property(DEAD_CLICKS_ENABLED_SERVER_SIDE)
    }

    public get isEnabled(): boolean {
        const clientConfig = this.instance.config.capture_dead_clicks
        return isBoolean(clientConfig) ? clientConfig : this.isRemoteEnabled
    }

    public afterDecideResponse(response: DecideResponse) {
        if (this.instance.persistence) {
            this.instance.persistence.register({
                [DEAD_CLICKS_ENABLED_SERVER_SIDE]: response?.captureDeadClicks,
            })
        }
        this.startIfEnabled()
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
                this.instance,
                isObject(this.instance.config.capture_dead_clicks)
                    ? this.instance.config.capture_dead_clicks
                    : undefined
            )
            this._lazyLoadedDeadClicksAutocapture.start(document)
            logger.info(`${LOGGER_PREFIX} starting...`)
        }
    }

    stop() {
        if (this._lazyLoadedDeadClicksAutocapture) {
            this._lazyLoadedDeadClicksAutocapture.stop()
            this._lazyLoadedDeadClicksAutocapture = undefined
            logger.info(`${LOGGER_PREFIX} stopping...`)
        }
    }
}
