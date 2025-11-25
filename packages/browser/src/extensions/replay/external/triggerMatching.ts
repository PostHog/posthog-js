import {
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
} from '../../../constants'
import { PostHog } from '../../../posthog-core'
import { FlagVariant, RemoteConfig, SessionRecordingPersistedConfig, SessionRecordingUrlTrigger } from '../../../types'
import { isNullish, isBoolean, isString, isObject } from '@posthog/core'
import { window } from '../../../utils/globals'

export const DISABLED = 'disabled'
export const SAMPLED = 'sampled'
export const ACTIVE = 'active'
export const BUFFERING = 'buffering'
export const PAUSED = 'paused'
export const LAZY_LOADING = 'lazy_loading'

const TRIGGER = 'trigger'
export const TRIGGER_ACTIVATED = TRIGGER + '_activated'
export const TRIGGER_PENDING = TRIGGER + '_pending'
export const TRIGGER_DISABLED = TRIGGER + '_' + DISABLED

export interface RecordingTriggersStatus {
    get receivedFlags(): boolean
    get isRecordingEnabled(): false | true | undefined
    get isSampled(): false | true | null
    get urlTriggerMatching(): URLTriggerMatching
    get eventTriggerMatching(): EventTriggerMatching
    get linkedFlagMatching(): LinkedFlagMatching
    get sessionId(): string
}

export type TriggerType = 'url' | 'event'
/* 
triggers can have one of three statuses:
 * - trigger_activated: the trigger met conditions to start recording
 * - trigger_pending: the trigger is present, but the conditions are not yet met
 * - trigger_disabled: the trigger is not present
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const triggerStatuses = [TRIGGER_ACTIVATED, TRIGGER_PENDING, TRIGGER_DISABLED] as const
export type TriggerStatus = (typeof triggerStatuses)[number]

/**
 * Session recording starts in buffering mode while waiting for "flags response".
 * Once the response is received, it might be disabled, active or sampled.
 * When "sampled" that means a sample rate is set, and the last time the session ID rotated
 * the sample rate determined this session should be sent to the server.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sessionRecordingStatuses = [DISABLED, SAMPLED, ACTIVE, BUFFERING, PAUSED, LAZY_LOADING] as const
export type SessionRecordingStatus = (typeof sessionRecordingStatuses)[number]

// while we have both lazy and eager loaded replay we might get either type of config
type ReplayConfigType = RemoteConfig | SessionRecordingPersistedConfig

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
    stop(): void
}
export class OrTriggerMatching implements TriggerStatusMatching {
    constructor(private readonly _matchers: TriggerStatusMatching[]) {}

    triggerStatus(sessionId: string): TriggerStatus {
        const statuses = this._matchers.map((m) => m.triggerStatus(sessionId))
        if (statuses.includes(TRIGGER_ACTIVATED)) {
            return TRIGGER_ACTIVATED
        }
        if (statuses.includes(TRIGGER_PENDING)) {
            return TRIGGER_PENDING
        }
        return TRIGGER_DISABLED
    }

    stop(): void {
        this._matchers.forEach((m) => m.stop())
    }
}

export class AndTriggerMatching implements TriggerStatusMatching {
    constructor(private readonly _matchers: TriggerStatusMatching[]) {}

    triggerStatus(sessionId: string): TriggerStatus {
        const statuses = new Set<TriggerStatus>()
        for (const matcher of this._matchers) {
            statuses.add(matcher.triggerStatus(sessionId))
        }

        // trigger_disabled means no config
        statuses.delete(TRIGGER_DISABLED)
        switch (statuses.size) {
            case 0:
                return TRIGGER_DISABLED
            case 1:
                return Array.from(statuses)[0]
            default:
                return TRIGGER_PENDING
        }
    }

    stop(): void {
        this._matchers.forEach((m) => m.stop())
    }
}

export class PendingTriggerMatching implements TriggerStatusMatching {
    triggerStatus(): TriggerStatus {
        return TRIGGER_PENDING
    }

    stop(): void {
        // no-op
    }
}

const isEagerLoadedConfig = (x: ReplayConfigType): x is RemoteConfig => {
    return 'sessionRecording' in x
}

export class URLTriggerMatching implements TriggerStatusMatching {
    _urlTriggers: SessionRecordingUrlTrigger[] = []
    _urlBlocklist: SessionRecordingUrlTrigger[] = []

    urlBlocked: boolean = false

    constructor(private readonly _instance: PostHog) {}

    onConfig(config: ReplayConfigType) {
        this._urlTriggers =
            (isEagerLoadedConfig(config)
                ? isObject(config.sessionRecording)
                    ? config.sessionRecording?.urlTriggers
                    : []
                : config?.urlTriggers) || []
        this._urlBlocklist =
            (isEagerLoadedConfig(config)
                ? isObject(config.sessionRecording)
                    ? config.sessionRecording?.urlBlocklist
                    : []
                : config?.urlBlocklist) || []
    }

    /**
     * @deprecated Use onConfig instead
     */
    onRemoteConfig(response: RemoteConfig) {
        this.onConfig(response)
    }

    private _urlTriggerStatus(sessionId: string): TriggerStatus {
        if (this._urlTriggers.length === 0) {
            return TRIGGER_DISABLED
        }

        const currentTriggerSession = this._instance?.get_property(SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION)
        return currentTriggerSession === sessionId ? TRIGGER_ACTIVATED : TRIGGER_PENDING
    }

    triggerStatus(sessionId: string): TriggerStatus {
        const urlTriggerStatus = this._urlTriggerStatus(sessionId)
        const eitherIsActivated = urlTriggerStatus === TRIGGER_ACTIVATED
        const eitherIsPending = urlTriggerStatus === TRIGGER_PENDING

        const result = eitherIsActivated ? TRIGGER_ACTIVATED : eitherIsPending ? TRIGGER_PENDING : TRIGGER_DISABLED
        this._instance.register_for_session({
            $sdk_debug_replay_url_trigger_status: result,
        })
        return result
    }

    checkUrlTriggerConditions(
        onPause: () => void,
        onResume: () => void,
        onActivate: (triggerType: TriggerType) => void,
        sessionId: string
    ) {
        if (typeof window === 'undefined' || !window.location.href) {
            return
        }

        const url = window.location.href

        const wasBlocked = this.urlBlocked
        const isNowBlocked = sessionRecordingUrlTriggerMatches(url, this._urlBlocklist)

        if (wasBlocked && isNowBlocked) {
            return
        }

        if (isNowBlocked && !wasBlocked) {
            onPause()
        } else if (!isNowBlocked && wasBlocked) {
            onResume()
        }

        const isActivated = this._urlTriggerStatus(sessionId) === TRIGGER_ACTIVATED
        const urlMatches = sessionRecordingUrlTriggerMatches(url, this._urlTriggers)

        if (!isActivated && urlMatches) {
            onActivate('url')
        }
    }

    stop(): void {
        // no-op
    }
}

export class LinkedFlagMatching implements TriggerStatusMatching {
    linkedFlag: string | FlagVariant | null = null
    linkedFlagSeen: boolean = false
    private _flagListenerCleanup: () => void = () => {}
    constructor(private readonly _instance: PostHog) {}

    triggerStatus(): TriggerStatus {
        let result = TRIGGER_PENDING
        if (isNullish(this.linkedFlag)) {
            result = TRIGGER_DISABLED
        }
        if (this.linkedFlagSeen) {
            result = TRIGGER_ACTIVATED
        }
        this._instance.register_for_session({
            $sdk_debug_replay_linked_flag_trigger_status: result,
        })
        return result
    }

    onConfig(config: ReplayConfigType, onStarted: (flag: string, variant: string | null) => void) {
        this.linkedFlag =
            (isEagerLoadedConfig(config)
                ? isObject(config.sessionRecording)
                    ? config.sessionRecording?.linkedFlag
                    : null
                : config?.linkedFlag) || null

        if (!isNullish(this.linkedFlag) && !this.linkedFlagSeen) {
            const linkedFlag = isString(this.linkedFlag) ? this.linkedFlag : this.linkedFlag.flag
            const linkedVariant = isString(this.linkedFlag) ? null : this.linkedFlag.variant
            this._flagListenerCleanup = this._instance.onFeatureFlags((_flags, variants) => {
                const flagIsPresent = isObject(variants) && linkedFlag in variants
                let linkedFlagMatches = false
                if (flagIsPresent) {
                    const variantForFlagKey = variants[linkedFlag]
                    if (isBoolean(variantForFlagKey)) {
                        linkedFlagMatches = variantForFlagKey === true
                    } else if (linkedVariant) {
                        linkedFlagMatches = variantForFlagKey === linkedVariant
                    } else {
                        // then this is a variant flag and we want to match any string
                        linkedFlagMatches = !!variantForFlagKey
                    }
                }
                this.linkedFlagSeen = linkedFlagMatches
                if (linkedFlagMatches) {
                    onStarted(linkedFlag, linkedVariant)
                }
            })
        }
    }

    /**
     * @deprecated Use onConfig instead
     */
    onRemoteConfig(response: RemoteConfig, onStarted: (flag: string, variant: string | null) => void) {
        this.onConfig(response, onStarted)
    }

    stop(): void {
        this._flagListenerCleanup()
    }
}

export class EventTriggerMatching implements TriggerStatusMatching {
    _eventTriggers: string[] = []

    constructor(private readonly _instance: PostHog) {}

    onConfig(config: ReplayConfigType) {
        this._eventTriggers =
            (isEagerLoadedConfig(config)
                ? isObject(config.sessionRecording)
                    ? config.sessionRecording?.eventTriggers
                    : []
                : config?.eventTriggers) || []
    }

    /**
     * @deprecated Use onConfig instead
     */
    onRemoteConfig(response: RemoteConfig) {
        this.onConfig(response)
    }

    private _eventTriggerStatus(sessionId: string): TriggerStatus {
        if (this._eventTriggers.length === 0) {
            return TRIGGER_DISABLED
        }

        const currentTriggerSession = this._instance?.get_property(SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION)
        return currentTriggerSession === sessionId ? TRIGGER_ACTIVATED : TRIGGER_PENDING
    }

    triggerStatus(sessionId: string): TriggerStatus {
        const eventTriggerStatus = this._eventTriggerStatus(sessionId)
        const result =
            eventTriggerStatus === TRIGGER_ACTIVATED
                ? TRIGGER_ACTIVATED
                : eventTriggerStatus === TRIGGER_PENDING
                  ? TRIGGER_PENDING
                  : TRIGGER_DISABLED
        this._instance.register_for_session({
            $sdk_debug_replay_event_trigger_status: result,
        })
        return result
    }

    stop(): void {
        // no-op
    }
}

// we need a no-op matcher before we can lazy-load the other matches, since all matchers wait on remote config anyway
export function nullMatchSessionRecordingStatus(triggersStatus: RecordingTriggersStatus): SessionRecordingStatus {
    if (!triggersStatus.isRecordingEnabled) {
        return DISABLED
    }

    return BUFFERING
}

export function anyMatchSessionRecordingStatus(triggersStatus: RecordingTriggersStatus): SessionRecordingStatus {
    if (!triggersStatus.receivedFlags) {
        return BUFFERING
    }

    if (!triggersStatus.isRecordingEnabled) {
        return DISABLED
    }

    if (triggersStatus.urlTriggerMatching.urlBlocked) {
        return PAUSED
    }

    const sampledActive = triggersStatus.isSampled === true
    const triggerMatches = new OrTriggerMatching([
        triggersStatus.eventTriggerMatching,
        triggersStatus.urlTriggerMatching,
        triggersStatus.linkedFlagMatching,
    ]).triggerStatus(triggersStatus.sessionId)

    if (sampledActive) {
        return SAMPLED
    }

    if (triggerMatches === TRIGGER_ACTIVATED) {
        return ACTIVE
    }

    if (triggerMatches === TRIGGER_PENDING) {
        // even if sampled active is false, we should still be buffering
        // since a pending trigger could override it
        return BUFFERING
    }

    // if sampling is set and the session is already decided to not be sampled
    // then we should never be active
    if (triggersStatus.isSampled === false) {
        return DISABLED
    }

    return ACTIVE
}

export function allMatchSessionRecordingStatus(triggersStatus: RecordingTriggersStatus): SessionRecordingStatus {
    if (!triggersStatus.receivedFlags) {
        return BUFFERING
    }

    if (!triggersStatus.isRecordingEnabled) {
        return DISABLED
    }

    if (triggersStatus.urlTriggerMatching.urlBlocked) {
        return PAUSED
    }

    const andTriggerMatch = new AndTriggerMatching([
        triggersStatus.eventTriggerMatching,
        triggersStatus.urlTriggerMatching,
        triggersStatus.linkedFlagMatching,
    ])
    const currentTriggerStatus = andTriggerMatch.triggerStatus(triggersStatus.sessionId)
    const hasTriggersConfigured = currentTriggerStatus !== TRIGGER_DISABLED

    const hasSamplingConfigured = isBoolean(triggersStatus.isSampled)

    if (hasTriggersConfigured && currentTriggerStatus === TRIGGER_PENDING) {
        return BUFFERING
    }

    if (hasTriggersConfigured && currentTriggerStatus === TRIGGER_DISABLED) {
        return DISABLED
    }

    // sampling can't ever cause buffering, it's always determined right away or not configured
    if (hasSamplingConfigured && !triggersStatus.isSampled) {
        return DISABLED
    }

    // If sampling is configured and set to true, return sampled
    if (triggersStatus.isSampled === true) {
        return SAMPLED
    }

    return ACTIVE
}
