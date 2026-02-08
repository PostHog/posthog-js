import type { PostHog } from '../../../posthog-core'
import type { RemoteConfig } from '../../../types'
import { window as globalWindow } from '../../../utils/globals'
import { createLogger } from '../../../utils/logger'

import type { Trigger, TriggerOptions, LogFn } from '../../triggers/behaviour/types'
import { PersistenceHelper } from '../../triggers/behaviour/persistence'
import { URLTrigger } from '../../triggers/behaviour/url-trigger'
import { FlagTrigger } from '../../triggers/behaviour/flag-trigger'
import { SampleRateTrigger } from '../../triggers/behaviour/sample-rate-trigger'
import { EventTrigger } from '../../triggers/behaviour/event-trigger'
import { isNull } from '@posthog/core'
import { getTriggersStatus, AutocaptureTriggersStatus } from './triggerStatusReporter'

const logger = createLogger('[Error Tracking Autocapture]')

const log: LogFn = (message, data) => {
    if (data) {
        logger.info(message, data)
    } else {
        logger.info(message)
    }
}

export class ErrorTrackingAutocaptureCompositeTrigger {
    private readonly _posthog: PostHog
    private _triggers: Trigger[] = []

    constructor(posthog: PostHog) {
        this._posthog = posthog
    }

    init(remoteConfig: RemoteConfig): void {
        const config = remoteConfig.errorTracking?.autoCaptureControls?.web

        const persistence = new PersistenceHelper(
            (key) => this._posthog.get_property(key),
            (key, value) => this._posthog.persistence?.register({ [key]: value })
        ).withPrefix('error_tracking')

        const options: TriggerOptions = {
            posthog: this._posthog,
            window: globalWindow,
            log,
            persistence,
        }

        this._triggers = [
            new URLTrigger(options, config?.urlTriggers ?? []),
            new EventTrigger(options, config?.eventTriggers ?? []),
            new FlagTrigger(options, config?.linkedFeatureFlag ?? null),
            new SampleRateTrigger(options, config?.sampleRate ?? null),
        ]

        this._triggers.forEach((trigger) => trigger.init())
    }

    matches(): boolean {
        const sessionId = this._posthog.get_session_id()

        for (const trigger of this._triggers) {
            const result = trigger.matches(sessionId)

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

    getStatus(): AutocaptureTriggersStatus {
        const sessionId = this._posthog.get_session_id()
        return getTriggersStatus(this._triggers, sessionId, this.matches())
    }
}
