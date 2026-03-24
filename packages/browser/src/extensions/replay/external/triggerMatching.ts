import {
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX,
    SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX,
} from '../../../constants'
import { PostHog } from '../../../posthog-core'
import { FlagVariant, RemoteConfig, SessionRecordingPersistedConfig, SessionRecordingUrlTrigger } from '../../../types'
import { isNullish, isBoolean, isString, isObject, isUndefined } from '@posthog/core'
import { window } from '../../../utils/globals'
import { logger } from '../../../utils/logger'

export const DISABLED = 'disabled'
export const SAMPLED = 'sampled'
export const ACTIVE = 'active'
export const BUFFERING = 'buffering'
export const PAUSED = 'paused'
export const LAZY_LOADING = 'lazy_loading'
export const AWAITING_CONFIG = 'awaiting_config'
export const MISSING_CONFIG = 'missing_config'
export const RRWEB_ERROR = 'rrweb_error'

const TRIGGER = 'trigger'
export const TRIGGER_ACTIVATED = TRIGGER + '_activated'
export const TRIGGER_PENDING = TRIGGER + '_pending'
export const TRIGGER_DISABLED = TRIGGER + '_' + DISABLED

export interface RecordingTriggersStatus {
    get receivedFlags(): boolean
    get isRecordingEnabled(): false | true | undefined
    get isSampled(): false | true | null
    get rrwebError(): boolean
    get urlTriggerMatching(): URLTriggerMatching
    get eventTriggerMatching(): EventTriggerMatching
    get linkedFlagMatching(): LinkedFlagMatching
    get sessionId(): string
}

/**
 * Extended interface for V2 trigger groups
 */
export interface RecordingTriggersStatusV2 extends RecordingTriggersStatus {
    get triggerGroupMatchers(): TriggerGroupMatching[]
    get triggerGroupSamplingResults(): Map<string, boolean> // group id -> sampled decision
    get minimumDuration(): number | null
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
const sessionRecordingStatuses = [
    DISABLED,
    SAMPLED,
    ACTIVE,
    BUFFERING,
    PAUSED,
    LAZY_LOADING,
    AWAITING_CONFIG,
    MISSING_CONFIG,
    RRWEB_ERROR,
] as const
export type SessionRecordingStatus = (typeof sessionRecordingStatuses)[number]

// while we have both lazy and eager loaded replay we might get either type of config
type ReplayConfigType = RemoteConfig | SessionRecordingPersistedConfig

// Type for trigger group matching config - subset of SessionRecordingPersistedConfig properties
type TriggerMatchingConfig = Pick<
    SessionRecordingPersistedConfig,
    'urlTriggers' | 'urlBlocklist' | 'eventTriggers' | 'linkedFlag'
>

function sessionRecordingUrlTriggerMatches(
    url: string,
    triggers: SessionRecordingUrlTrigger[],
    compiledRegexCache?: Map<string, RegExp>
) {
    return triggers.some((trigger) => {
        switch (trigger.matching) {
            case 'regex': {
                const regex = compiledRegexCache?.get(trigger.url) ?? new RegExp(trigger.url)
                return regex.test(url)
            }
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

export class AlwaysActivatedTriggerMatching implements TriggerStatusMatching {
    triggerStatus(): TriggerStatus {
        return TRIGGER_ACTIVATED
    }

    stop(): void {
        // no-op
    }
}

const isEagerLoadedConfig = (x: ReplayConfigType | TriggerMatchingConfig): x is RemoteConfig => {
    return 'sessionRecording' in x
}

export class URLTriggerMatching implements TriggerStatusMatching {
    _urlTriggers: SessionRecordingUrlTrigger[] = []
    _urlBlocklist: SessionRecordingUrlTrigger[] = []

    private _compiledTriggerRegexes: Map<string, RegExp> = new Map()
    private _compiledBlocklistRegexes: Map<string, RegExp> = new Map()

    private _lastCheckedUrl: string = ''
    private _groupId?: string // Optional group ID for V2 per-group persistence

    urlBlocked: boolean = false

    constructor(
        private readonly _instance: PostHog,
        groupId?: string
    ) {
        this._groupId = groupId
    }

    onConfig(config: ReplayConfigType | TriggerMatchingConfig) {
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

        this._compileRegexCache()
    }

    /**
     * Compiles and caches RegExp objects from URL triggers and blocklist.
     * This prevents recreating RegExp objects on every rrweb event
     */
    private _compileRegexCache(): void {
        this._compiledTriggerRegexes.clear()
        this._compiledBlocklistRegexes.clear()

        for (const trigger of this._urlTriggers) {
            if (trigger.matching === 'regex' && !this._compiledTriggerRegexes.has(trigger.url)) {
                try {
                    this._compiledTriggerRegexes.set(trigger.url, new RegExp(trigger.url))
                } catch (e) {
                    logger.error('Invalid URL trigger regex pattern:', trigger.url, e)
                }
            }
        }

        for (const trigger of this._urlBlocklist) {
            if (trigger.matching === 'regex' && !this._compiledBlocklistRegexes.has(trigger.url)) {
                try {
                    this._compiledBlocklistRegexes.set(trigger.url, new RegExp(trigger.url))
                } catch (e) {
                    logger.error('Invalid URL blocklist regex pattern:', trigger.url, e)
                }
            }
        }
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

        // V2: Use per-group persistence key if groupId is provided
        const persistenceKey = this._groupId
            ? SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX + this._groupId
            : SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION

        const currentTriggerSession = this._instance?.get_property(persistenceKey)
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

    /**
     * Check URL blocklist and pause/resume recording accordingly
     * This is separate from trigger checking and is used by both V1 and V2
     *
     * Performance optimization: Only checks when URL changes to avoid redundant regex matching
     */
    checkUrlBlocklist(onPause: () => void, onResume: () => void): void {
        if (typeof window === 'undefined' || !window.location.href) {
            return
        }

        const url = window.location.href

        // Performance optimization: Skip if URL hasn't changed since last check
        if (url === this._lastCheckedUrl) {
            return
        }
        this._lastCheckedUrl = url

        // Check blocklist and call onPause/onResume
        // Note: DON'T set this.urlBlocked here - let the callbacks (_pauseRecording/_resumeRecording) set it
        const wasBlocked = this.urlBlocked
        const isNowBlocked = sessionRecordingUrlTriggerMatches(url, this._urlBlocklist, this._compiledBlocklistRegexes)

        if (wasBlocked && isNowBlocked) {
            return
        }

        if (isNowBlocked && !wasBlocked) {
            onPause()
        } else if (!isNowBlocked && wasBlocked) {
            onResume()
        }
    }

    checkUrlTriggerConditions(
        onPause: () => void,
        onResume: () => void,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void,
        sessionId: string
    ) {
        if (typeof window === 'undefined' || !window.location.href) {
            return
        }

        const url = window.location.href

        // Performance optimization: Skip if URL hasn't changed since last check
        // This prevents redundant checks on every rrweb event
        if (url === this._lastCheckedUrl) {
            return
        }
        this._lastCheckedUrl = url

        // Check blocklist and call onPause/onResume
        // Note: DON'T set this.urlBlocked here - let the callbacks (_pauseRecording/_resumeRecording) set it
        const wasBlocked = this.urlBlocked
        const isNowBlocked = sessionRecordingUrlTriggerMatches(url, this._urlBlocklist, this._compiledBlocklistRegexes)

        if (isNowBlocked && !wasBlocked) {
            onPause()
        } else if (!isNowBlocked && wasBlocked) {
            onResume()
        }

        // Check URL triggers (V1 only - V2 handles per-group)
        const isActivated = this._urlTriggerStatus(sessionId) === TRIGGER_ACTIVATED
        const urlMatches = sessionRecordingUrlTriggerMatches(url, this._urlTriggers, this._compiledTriggerRegexes)

        if (!isActivated && urlMatches) {
            onActivate('url', url)
        }
    }

    stop(): void {
        this._lastCheckedUrl = ''
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

    onConfig(
        config: ReplayConfigType | TriggerMatchingConfig,
        onStarted: (flag: string, variant: string | null) => void
    ) {
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
    private _groupId?: string // Optional group ID for V2 per-group persistence

    constructor(
        private readonly _instance: PostHog,
        groupId?: string
    ) {
        this._groupId = groupId
    }

    onConfig(config: ReplayConfigType | TriggerMatchingConfig) {
        // Handle both RemoteConfig (nested) and SessionRecordingPersistedConfig (flattened) structures
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

        // V2: Use per-group persistence key if groupId is provided
        const persistenceKey = this._groupId
            ? SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX + this._groupId
            : SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION

        const currentTriggerSession = this._instance?.get_property(persistenceKey)
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

    checkEventTriggerConditions(
        eventName: string,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void,
        sessionId: string
    ) {
        if (this._eventTriggers.length === 0) {
            return
        }

        const isActivated = this._eventTriggerStatus(sessionId) === TRIGGER_ACTIVATED
        const includes = this._eventTriggers.includes(eventName)
        if (!isActivated && includes) {
            onActivate('event', eventName)
        }
    }

    stop(): void {
        // no-op
    }
}

/**
 * V2 Trigger Group Matching - manages a single trigger group with its own conditions
 */
export class TriggerGroupMatching implements TriggerStatusMatching {
    private _urlTriggerMatching: URLTriggerMatching
    private _eventTriggerMatching: EventTriggerMatching
    private _linkedFlagMatching: LinkedFlagMatching
    private _combinedMatching: TriggerStatusMatching
    public readonly group: import('../../../types').SessionRecordingTriggerGroup

    constructor(
        private readonly _instance: PostHog,
        group: import('../../../types').SessionRecordingTriggerGroup,
        onFlagStarted: (flag: string, variant: string | null) => void
    ) {
        this.group = group
        // V2: Pass groupId to child matchers for per-group persistence
        this._urlTriggerMatching = new URLTriggerMatching(_instance, group.id)
        this._eventTriggerMatching = new EventTriggerMatching(_instance, group.id)
        this._linkedFlagMatching = new LinkedFlagMatching(_instance)

        // Check if all conditions are empty (no events, urls, or flags)
        const hasEvents = group.conditions.events && group.conditions.events.length > 0
        const hasUrls = group.conditions.urls && group.conditions.urls.length > 0
        const hasFlag = !!group.conditions.flag

        if (!hasEvents && !hasUrls && !hasFlag) {
            // Empty conditions = trigger immediately on session start
            this._combinedMatching = new AlwaysActivatedTriggerMatching()
        } else {
            // Convert group config to the format expected by the individual matchers
            const config: TriggerMatchingConfig = {
                urlTriggers: group.conditions.urls || [],
                eventTriggers: group.conditions.events || [],
                linkedFlag: group.conditions.flag || null,
                urlBlocklist: [], // groups don't have blocklist
            }

            this._urlTriggerMatching.onConfig(config)
            this._eventTriggerMatching.onConfig(config)
            this._linkedFlagMatching.onConfig(config, onFlagStarted)

            // Combine matchers based on the group's matchType
            const matchers = [this._eventTriggerMatching, this._urlTriggerMatching, this._linkedFlagMatching]
            this._combinedMatching =
                group.conditions.matchType === 'any'
                    ? new OrTriggerMatching(matchers)
                    : new AndTriggerMatching(matchers)
        }
    }

    triggerStatus(sessionId: string): TriggerStatus {
        return this._combinedMatching.triggerStatus(sessionId)
    }

    checkEventTriggerConditions(
        eventName: string,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void,
        sessionId: string
    ) {
        this._eventTriggerMatching.checkEventTriggerConditions(eventName, onActivate, sessionId)
    }

    checkUrlTriggerConditions(
        onPause: () => void,
        onResume: () => void,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void,
        sessionId: string
    ) {
        this._urlTriggerMatching.checkUrlTriggerConditions(onPause, onResume, onActivate, sessionId)
    }

    /**
     * V2: Activate this group's trigger and persist to group-specific key
     * This prevents cross-group contamination and survives page reloads
     */
    activateTrigger(triggerType: TriggerType, sessionId: string): void {
        const persistenceKey =
            triggerType === 'url'
                ? SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX + this.group.id
                : SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX + this.group.id

        this._instance.persistence?.register({
            [persistenceKey]: sessionId,
        })
    }

    stop(): void {
        this._urlTriggerMatching.stop()
        this._eventTriggerMatching.stop()
        this._linkedFlagMatching.stop()
    }
}

// we need a no-op matcher before we can lazy-load the other matches, since all matchers wait on remote config anyway
export function nullMatchSessionRecordingStatus(triggersStatus: RecordingTriggersStatus): SessionRecordingStatus {
    if (triggersStatus.rrwebError) {
        return RRWEB_ERROR
    }

    if (!triggersStatus.isRecordingEnabled) {
        return DISABLED
    }

    return BUFFERING
}

export function anyMatchSessionRecordingStatus(triggersStatus: RecordingTriggersStatus): SessionRecordingStatus {
    if (triggersStatus.rrwebError) {
        return RRWEB_ERROR
    }

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
    if (triggersStatus.rrwebError) {
        return RRWEB_ERROR
    }

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

/**
 * V2 Trigger Groups Status Matcher - implements union behavior:
 * 1. Evaluate ALL trigger groups
 * 2. For each matching group, check if its sample rate hits
 * 3. If ANY group's sample rate hits → record session
 */
export function triggerGroupsMatchSessionRecordingStatus(
    triggersStatus: RecordingTriggersStatusV2
): SessionRecordingStatus {
    if (triggersStatus.rrwebError) {
        return RRWEB_ERROR
    }

    if (!triggersStatus.receivedFlags) {
        return BUFFERING
    }

    if (!triggersStatus.isRecordingEnabled) {
        return DISABLED
    }

    // Check if any URL is blocked (url blocklist is global, not per-group)
    if (triggersStatus.urlTriggerMatching.urlBlocked) {
        return PAUSED
    }

    const groupMatchers = triggersStatus.triggerGroupMatchers
    const samplingResults = triggersStatus.triggerGroupSamplingResults

    if (groupMatchers.length === 0) {
        // No V2 groups configured - should not happen, but treat as disabled
        return DISABLED
    }

    // Evaluate all groups to determine overall status
    let anyGroupPending = false
    let anyGroupSampled = false

    for (const matcher of groupMatchers) {
        const groupStatus = matcher.triggerStatus(triggersStatus.sessionId)

        if (groupStatus === TRIGGER_ACTIVATED) {
            // Check if this group's sample rate hit
            const groupId = matcher.group.id
            const samplingResult = samplingResults.get(groupId)

            if (isUndefined(samplingResult)) {
                logger.warn('[V2 Triggers] Group activated but no sampling decision found', { groupId })
            } else if (samplingResult === true) {
                anyGroupSampled = true
            }
        } else if (groupStatus === TRIGGER_PENDING) {
            anyGroupPending = true
        }
    }

    // Union behavior: if ANY group hit its sample rate, record
    if (anyGroupSampled) {
        return SAMPLED
    }

    // If any group is pending, keep buffering
    if (anyGroupPending) {
        return BUFFERING
    }

    // All groups are either disabled, conditions not met, or sampled out
    return DISABLED
}
