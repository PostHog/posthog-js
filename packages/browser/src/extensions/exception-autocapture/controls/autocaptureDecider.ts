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

// Storage keys for session persistence
const STORAGE_PREFIX = '$error_tracking_'
const URL_TRIGGER_SESSION_KEY = `${STORAGE_PREFIX}url_trigger_session`
const EVENT_TRIGGER_SESSION_KEY = `${STORAGE_PREFIX}event_trigger_session`
const FLAG_TRIGGER_SESSION_KEY = `${STORAGE_PREFIX}flag_trigger_session`
const SAMPLE_TRIGGER_SESSION_KEY = `${STORAGE_PREFIX}sample_trigger_session`

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
            getPersistedSessionId: () => this._getPersistedSessionId(URL_TRIGGER_SESSION_KEY),
            setPersistedSessionId: (sessionId) => this._setPersistedSessionId(URL_TRIGGER_SESSION_KEY, sessionId),
        })
        this._triggers.push(urlTrigger)

        const eventTrigger = new EventTrigger()
        eventTrigger.init(config?.eventTriggers ?? [], {
            posthog: this._posthog,
            log,
            getPersistedSessionId: () => this._getPersistedSessionId(EVENT_TRIGGER_SESSION_KEY),
            setPersistedSessionId: (sessionId) => this._setPersistedSessionId(EVENT_TRIGGER_SESSION_KEY, sessionId),
        })
        this._triggers.push(eventTrigger)

        const flagTrigger = new FlagTrigger()
        flagTrigger.init(config?.linkedFeatureFlag ?? null, {
            posthog: this._posthog,
            log,
            getPersistedSessionId: () => this._getPersistedSessionId(FLAG_TRIGGER_SESSION_KEY),
            setPersistedSessionId: (sessionId) => this._setPersistedSessionId(FLAG_TRIGGER_SESSION_KEY, sessionId),
        })
        this._triggers.push(flagTrigger)

        const sampleTrigger = new SampleTrigger()
        sampleTrigger.init(config?.sampleRate ?? null, {
            log,
            getPersistedSessionId: () => this._getPersistedSessionId(SAMPLE_TRIGGER_SESSION_KEY),
            setPersistedSessionId: (sessionId) => this._setPersistedSessionId(SAMPLE_TRIGGER_SESSION_KEY, sessionId),
        })
        this._triggers.push(sampleTrigger)
    }

    shouldCapture(): boolean {
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

    private _getPersistedSessionId(key: string): string | null {
        return (this._posthog.get_property(key) as string) ?? null
    }

    private _setPersistedSessionId(key: string, sessionId: string): void {
        this._posthog.persistence?.register({ [key]: sessionId })
    }
}
