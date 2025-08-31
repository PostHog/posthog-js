import { PostHog } from '../posthog-core'
import { DEAD_CLICKS_ENABLED_SERVER_SIDE } from '../constants'
import { isBoolean, isObject } from '@posthog/core'
import { assignableWindow, document, LazyLoadedDeadClicksAutocaptureInterface } from '../utils/globals'
import { createLogger } from '../utils/logger'
import { DeadClicksAutoCaptureConfig, RemoteConfig } from '../types'

const logger = createLogger('[Dead Clicks]')

export const isDeadClicksEnabledForHeatmaps = () => {
    return true
}
export const isDeadClicksEnabledForAutocapture = (instance: DeadClicksAutocapture) => {
    const isRemoteEnabled = !!instance.instance.persistence?.get_property(DEAD_CLICKS_ENABLED_SERVER_SIDE)
    const clientConfig = instance.instance.config.capture_dead_clicks
    return isBoolean(clientConfig) ? clientConfig : isRemoteEnabled
}

export class DeadClicksAutocapture {
    get lazyLoadedDeadClicksAutocapture(): LazyLoadedDeadClicksAutocaptureInterface | undefined {
        return this._lazyLoadedDeadClicksAutocapture
    }

    private _lazyLoadedDeadClicksAutocapture: LazyLoadedDeadClicksAutocaptureInterface | undefined

    constructor(
        readonly instance: PostHog,
        readonly isEnabled: (dca: DeadClicksAutocapture) => boolean,
        readonly onCapture?: DeadClicksAutoCaptureConfig['__onCapture']
    ) {
        this.startIfEnabled()
    }

    public onRemoteConfig(response: RemoteConfig) {
        if (this.instance.persistence) {
            this.instance.persistence.register({
                [DEAD_CLICKS_ENABLED_SERVER_SIDE]: response?.captureDeadClicks,
            })
        }
        this.startIfEnabled()
    }

    public startIfEnabled() {
        if (this.isEnabled(this)) {
            this._loadScript(() => {
                this._start()
            })
        }
    }

    private _loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.initDeadClicksAutocapture) {
            // already loaded
            cb()
        }
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(
            this.instance,
            'dead-clicks-autocapture',
            (err) => {
                if (err) {
                    logger.error('failed to load script', err)
                    return
                }
                cb()
            }
        )
    }

    private _start() {
        if (!document) {
            logger.error('`document` not found. Cannot start.')
            return
        }

        if (
            !this._lazyLoadedDeadClicksAutocapture &&
            assignableWindow.__PosthogExtensions__?.initDeadClicksAutocapture
        ) {
            const config = isObject(this.instance.config.capture_dead_clicks)
                ? this.instance.config.capture_dead_clicks
                : {}
            config.__onCapture = this.onCapture

            this._lazyLoadedDeadClicksAutocapture = assignableWindow.__PosthogExtensions__.initDeadClicksAutocapture(
                this.instance,
                config
            )
            this._lazyLoadedDeadClicksAutocapture.start(document)
            logger.info(`starting...`)
        }
    }

    stop() {
        if (this._lazyLoadedDeadClicksAutocapture) {
            this._lazyLoadedDeadClicksAutocapture.stop()
            this._lazyLoadedDeadClicksAutocapture = undefined
            logger.info(`stopping...`)
        }
    }
}
