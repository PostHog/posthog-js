import type { PostHog } from '../../../posthog-core'
import type { RemoteConfig } from '../../../types'
import { window as globalWindow } from '../../../utils/globals'
import { createLogger } from '../../../utils/logger'

import type { Trigger, LogFn } from './triggers/types'
import { URLTrigger } from './triggers/url-trigger'
import { FlagTrigger } from './triggers/flag-trigger'
import { SampleTrigger } from './triggers/sample-trigger'
import { EventTrigger } from './triggers/event-trigger'
import { isNull } from '@posthog/core'

const logger = createLogger('[Error Tracking Autocapture Decider]')

const log: LogFn = (message, data) => {
    if (data) {
        logger.info(message, data)
    } else {
        logger.info(message)
    }
}

export class AutocaptureDecider {
    private readonly _posthog: PostHog
    private readonly _triggers: Trigger[] = []

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    init(remoteConfig: RemoteConfig): void {
        const config = remoteConfig.errorTracking?.autoCaptureControls?.web

        this._triggers.length = 0

        const urlTrigger = new URLTrigger()
        urlTrigger.init(config?.urlTriggers ?? [], {
            window: globalWindow,
            log,
        })
        this._triggers.push(urlTrigger)

        const eventTrigger = new EventTrigger()
        eventTrigger.init(config?.eventTriggers ?? [], {
            posthog: this._posthog,
            log,
        })
        this._triggers.push(eventTrigger)

        const flagTrigger = new FlagTrigger()
        flagTrigger.init(config?.linkedFeatureFlag ?? null, {
            posthog: this._posthog,
            log,
        })
        this._triggers.push(flagTrigger)

        const sampleTrigger = new SampleTrigger()
        sampleTrigger.init(config?.sampleRate ?? null, {
            log,
        })
        this._triggers.push(sampleTrigger)
    }

    shouldCapture(): boolean {
        for (const trigger of this._triggers) {
            const result = trigger.shouldCapture()

            if (isNull(result)) {
                continue
            }

            if (!result) {
                logger.info(`Blocked by ${trigger.name}`)
                return false
            }
        }

        return true
    }
}
