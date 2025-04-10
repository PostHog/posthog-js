import {
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
} from '../../constants'
import { PostHog } from '../../posthog-core'
import { FlagVariant, RemoteConfig, SessionRecordingUrlTrigger } from '../../types'
import { isBoolean, isObject, isString } from '../../utils/type-utils'
import { isNullish } from '../../utils/type-utils'
import { window } from '../../utils/globals'

export type TriggerType = 'url' | 'event'
/* 
triggers can have one of three statuses:
 * - trigger_activated: the trigger met conditions to start recording
 * - trigger_pending: the trigger is present but the conditions are not yet met
 * - trigger_disabled: the trigger is not present
 */
export type TriggerStatus = 'trigger_activated' | 'trigger_pending' | 'trigger_disabled'

/**
 * Session recording starts in buffering mode while waiting for decide response
 * Once the response is received it might be disabled, active or sampled
 * When sampled that means a sample rate is set and the last time the session id was rotated
 * the sample rate determined this session should be sent to the server.
 */
export type SessionRecordingStatus = 'disabled' | 'sampled' | 'active' | 'buffering' | 'paused'

function sessionRecordingUrlTriggerMatches(url: string, triggers: SessionRecordingUrlTrigger[]) {
    return triggers.some((trigger) => {
        switch (trigger.matching) {
            case 'regex':
                return new RegExp(trigger.url).test(url)
            default:
                return false
        }
    })
}

export interface TriggerStatusMatching {
    triggerStatus(sessionId: string): TriggerStatus
}

export class OrTriggerMatching implements TriggerStatusMatching {
    constructor(private readonly matchers: TriggerStatusMatching[]) {}

    triggerStatus(sessionId: string): TriggerStatus {
        const statuses = this.matchers.map((m) => m.triggerStatus(sessionId))
        if (statuses.includes('trigger_activated')) {
            return 'trigger_activated'
        }
        if (statuses.includes('trigger_pending')) {
            return 'trigger_pending'
        }
        return 'trigger_disabled'
    }
}

export class AndTriggerMatching implements TriggerStatusMatching {
    constructor(private readonly matchers: TriggerStatusMatching[]) {}

    triggerStatus(sessionId: string): TriggerStatus {
        const statuses = new Set<TriggerStatus>()
        for (const matcher of this.matchers) {
            statuses.add(matcher.triggerStatus(sessionId))
        }

        // trigger_disabled means no config
        statuses.delete('trigger_disabled')
        switch (statuses.size) {
            case 0:
                return 'trigger_disabled'
            case 1:
                return Array.from(statuses)[0]
            default:
                return 'trigger_pending'
        }
    }
}

export class PendingTriggerMatching implements TriggerStatusMatching {
    triggerStatus(): TriggerStatus {
        return 'trigger_pending'
    }
}

export class URLTriggerMatching implements TriggerStatusMatching {
    _urlTriggers: SessionRecordingUrlTrigger[] = []
    _urlBlocklist: SessionRecordingUrlTrigger[] = []

    private _urlBlocked: boolean = false

    get urlBlocked(): boolean {
        return this._urlBlocked
    }

    set urlBlocked(value: boolean) {
        this._urlBlocked = value
    }

    constructor(private readonly instance: PostHog) {}

    onRemoteConfig(response: RemoteConfig) {
        this._urlTriggers = response.sessionRecording?.urlTriggers || []
        this._urlBlocklist = response.sessionRecording?.urlBlocklist || []
    }

    private urlTriggerStatus(sessionId: string): TriggerStatus {
        if (this._urlTriggers.length === 0) {
            return 'trigger_disabled'
        }

        const currentTriggerSession = this.instance?.get_property(SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION)
        return currentTriggerSession === sessionId ? 'trigger_activated' : 'trigger_pending'
    }

    triggerStatus(sessionId: string): TriggerStatus {
        const urlTriggerStatus = this.urlTriggerStatus(sessionId)
        const eitherIsActivated = urlTriggerStatus === 'trigger_activated'
        const eitherIsPending = urlTriggerStatus === 'trigger_pending'

        return eitherIsActivated ? 'trigger_activated' : eitherIsPending ? 'trigger_pending' : 'trigger_disabled'
    }

    checkUrlTriggerConditions(
        onPause: () => void,
        onResume: () => void,
        onActivate: (triggerType: TriggerType) => void
    ) {
        if (typeof window === 'undefined' || !window.location.href) {
            return
        }

        const url = window.location.href

        const wasBlocked = this._urlBlocked
        const isNowBlocked = sessionRecordingUrlTriggerMatches(url, this._urlBlocklist)

        if (isNowBlocked && !wasBlocked) {
            onPause()
        } else if (!isNowBlocked && wasBlocked) {
            onResume()
        }

        if (sessionRecordingUrlTriggerMatches(url, this._urlTriggers)) {
            onActivate('url')
        }
    }
}

export class LinkedFlagMatching implements TriggerStatusMatching {
    linkedFlag: string | FlagVariant | null = null
    linkedFlagSeen: boolean = false

    constructor(private readonly instance: PostHog) {}

    triggerStatus(): TriggerStatus {
        if (isNullish(this.linkedFlag)) {
            return 'trigger_disabled'
        }
        if (this.linkedFlagSeen) {
            return 'trigger_activated'
        }
        return 'trigger_pending'
    }

    onRemoteConfig(response: RemoteConfig, onStarted: (flag: string, variant: string | null) => void) {
        this.linkedFlag = response.sessionRecording?.linkedFlag || null

        if (!isNullish(this.linkedFlag) && !this.linkedFlagSeen) {
            const linkedFlag = isString(this.linkedFlag) ? this.linkedFlag : this.linkedFlag.flag
            const linkedVariant = isString(this.linkedFlag) ? null : this.linkedFlag.variant
            this.instance.onFeatureFlags((_flags, variants) => {
                const flagIsPresent = isObject(variants) && linkedFlag in variants
                const linkedFlagMatches = linkedVariant ? variants[linkedFlag] === linkedVariant : flagIsPresent
                if (linkedFlagMatches) {
                    onStarted(linkedFlag, linkedVariant)
                }
                this.linkedFlagSeen = linkedFlagMatches
            })
        }
    }
}

export class EventTriggerMatching implements TriggerStatusMatching {
    _eventTriggers: string[] = []

    constructor(private readonly instance: PostHog) {}

    onRemoteConfig(response: RemoteConfig) {
        this._eventTriggers = response.sessionRecording?.eventTriggers || []
    }

    private eventTriggerStatus(sessionId: string): TriggerStatus {
        if (this._eventTriggers.length === 0) {
            return 'trigger_disabled'
        }

        const currentTriggerSession = this.instance?.get_property(SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION)
        return currentTriggerSession === sessionId ? 'trigger_activated' : 'trigger_pending'
    }

    triggerStatus(sessionId: string): TriggerStatus {
        const eventTriggerStatus = this.eventTriggerStatus(sessionId)
        return eventTriggerStatus === 'trigger_activated'
            ? 'trigger_activated'
            : eventTriggerStatus === 'trigger_pending'
              ? 'trigger_pending'
              : 'trigger_disabled'
    }
}

export interface RecordingTriggersStatus {
    get receivedDecide(): boolean
    get isRecordingEnabled(): false | true | undefined
    get isSampled(): false | true | null
    get urlTriggerMatching(): URLTriggerMatching
    get eventTriggerMatching(): EventTriggerMatching
    get linkedFlagMatching(): LinkedFlagMatching
    get sessionId(): string
}

// we need a no-op matcher before we can lazy load the other matches, since all matchers wait on remote config anyway
export function nullMatchSessionRecordingStatus(triggersStatus: RecordingTriggersStatus): SessionRecordingStatus {
    if (!triggersStatus.isRecordingEnabled) {
        return 'disabled'
    }

    return 'buffering'
}

export function anyMatchSessionRecordingStatus(triggersStatus: RecordingTriggersStatus): SessionRecordingStatus {
    if (!triggersStatus.receivedDecide) {
        return 'buffering'
    }

    if (!triggersStatus.isRecordingEnabled) {
        return 'disabled'
    }

    if (triggersStatus.urlTriggerMatching.urlBlocked) {
        return 'paused'
    }

    const sampledActive = triggersStatus.isSampled === true
    const triggerMatches = new OrTriggerMatching([
        triggersStatus.eventTriggerMatching,
        triggersStatus.urlTriggerMatching,
        triggersStatus.linkedFlagMatching,
    ]).triggerStatus(triggersStatus.sessionId)

    if (sampledActive || triggerMatches === 'trigger_activated') {
        return sampledActive ? 'sampled' : 'active'
    }

    if (triggerMatches == 'trigger_pending') {
        // even if sampled active is false, we should still be buffering
        // since a pending trigger could override it
        return 'buffering'
    }

    // if sampling is set and the session is already decided to not be sampled
    // then we should never be active
    if (triggersStatus.isSampled === false) {
        return 'disabled'
    }

    if (triggersStatus.urlTriggerMatching.urlBlocked) {
        return 'paused'
    }

    if (
        new OrTriggerMatching([
            triggersStatus.eventTriggerMatching,
            triggersStatus.urlTriggerMatching,
            triggersStatus.linkedFlagMatching,
        ]).triggerStatus(triggersStatus.sessionId) === 'trigger_pending'
    ) {
        return 'buffering'
    }

    if (isBoolean(triggersStatus.isSampled)) {
        return triggersStatus.isSampled ? 'sampled' : 'disabled'
    } else {
        return 'active'
    }
}

export function allMatchSessionRecordingStatus(triggersStatus: RecordingTriggersStatus): SessionRecordingStatus {
    if (!triggersStatus.receivedDecide) {
        return 'buffering'
    }

    if (!triggersStatus.isRecordingEnabled) {
        return 'disabled'
    }

    if (triggersStatus.urlTriggerMatching.urlBlocked) {
        return 'paused'
    }

    const andTriggerMatch = new AndTriggerMatching([
        triggersStatus.eventTriggerMatching,
        triggersStatus.urlTriggerMatching,
        triggersStatus.linkedFlagMatching,
    ])
    const hasTriggersConfigured = andTriggerMatch.triggerStatus(triggersStatus.sessionId) !== 'trigger_disabled'

    const hasSamplingConfigured = isBoolean(triggersStatus.isSampled)

    if (hasTriggersConfigured && andTriggerMatch.triggerStatus(triggersStatus.sessionId) === 'trigger_pending') {
        return 'buffering'
    }

    if (hasTriggersConfigured && andTriggerMatch.triggerStatus(triggersStatus.sessionId) === 'trigger_disabled') {
        return 'disabled'
    }

    // sampling can't ever cause buffering, it's always determined right away or not configured
    if (hasSamplingConfigured && triggersStatus.isSampled === false) {
        return 'disabled'
    }

    // If sampling is configured and set to true, return sampled
    if (triggersStatus.isSampled === true) {
        return 'sampled'
    }

    // All configured matches are satisfied
    return 'active'
}
