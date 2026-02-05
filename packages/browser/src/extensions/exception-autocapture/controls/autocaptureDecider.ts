import type { PostHog } from '../../../posthog-core'
import type { ErrorTrackingAutoCaptureControls, RemoteConfig } from '../../../types'
import { window as globalWindow } from '../../../utils/globals'
import { createLogger } from '../../../utils/logger'

import type { Decider, DeciderContext } from './deciders/types'
import { URLDecider } from './deciders/url-decider'
import { FlagDecider } from './deciders/flag-decider'
import { SampleDecider } from './deciders/sample-decider'
import { EventDecider } from './deciders/event-decider'
import { isNull } from '@posthog/core'

const logger = createLogger('[Error Tracking Autocapture Decider]')

export class AutocaptureDecider {
    private readonly _posthog: PostHog
    private readonly _deciders: Decider[] = []

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    init(remoteConfig: RemoteConfig): void {
        const autoCaptureConfig = remoteConfig.errorTracking?.autoCaptureControls?.web
        const context = this._buildContext(autoCaptureConfig)

        this._deciders.length = 0
        this._deciders.push(new URLDecider(), new EventDecider(), new FlagDecider(), new SampleDecider())

        for (const decider of this._deciders) {
            decider.init(context)
        }
    }

    shouldCapture(): boolean {
        for (const decider of this._deciders) {
            const result = decider.shouldCapture()

            if (isNull(result)) {
                continue
            }

            if (!result) {
                logger.info(`Blocked by ${decider.name}`)
                return false
            }
        }

        return true
    }

    private _buildContext(config: ErrorTrackingAutoCaptureControls | undefined): DeciderContext {
        return {
            posthog: this._posthog,
            window: globalWindow,
            config,
            log: (message, data) => {
                if (data) {
                    logger.info(message, data)
                } else {
                    logger.info(message)
                }
            },
        }
    }
}
