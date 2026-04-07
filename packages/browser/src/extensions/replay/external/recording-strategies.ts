import { PostHog } from '../../../posthog-core'
import {
    CaptureResult,
    SessionRecordingPersistedConfig,
    SessionRecordingTriggerGroup,
    SessionStartReason,
} from '../../../types'
import {
    SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION,
    SESSION_RECORDING_IS_SAMPLED,
    SESSION_RECORDING_PAST_MINIMUM_DURATION,
    SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX,
    SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX,
    SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX,
    STORED_PERSON_PROPERTIES_KEY,
} from '../../../constants'
import {
    EventTriggerMatching,
    LinkedFlagMatching,
    URLTriggerMatching,
    TriggerGroupMatching,
    SessionRecordingStatus,
    allMatchSessionRecordingStatus,
    anyMatchSessionRecordingStatus,
    triggerGroupsMatchSessionRecordingStatus,
    RecordingTriggersStatusV2,
    TriggerType,
    AndTriggerMatching,
    OrTriggerMatching,
    TriggerStatusMatching,
    TRIGGER_PENDING,
} from './triggerMatching'
import { sampleOnProperty } from '../../sampling'
import { isBoolean, isNull, isNullish, isNumber } from '@posthog/core'
import { createLogger } from '../../../utils/logger'
import { matchTriggerPropertyFilters } from '../../../utils/property-utils'

const logger = createLogger('[SessionRecording]')

/**
 * Shared context that strategies need to access from the recorder
 */
export interface RecordingStrategyContext {
    instance: PostHog
    sessionId: string
    isSampled: boolean | null
    rrwebError: boolean
    urlTriggerMatching: URLTriggerMatching
    eventTriggerMatching: EventTriggerMatching
    linkedFlagMatching: LinkedFlagMatching
    remoteConfig: SessionRecordingPersistedConfig | undefined
}

/**
 * Strategy interface for handling different recording trigger configurations
 */
export interface RecordingStrategy {
    /**
     * Initialize the strategy with remote config
     */
    onRemoteConfig(config: SessionRecordingPersistedConfig): void

    /**
     * Get the current recording status
     */
    getStatus(context: RecordingStrategyContext): SessionRecordingStatus

    /**
     * Get the minimum duration for this session (if any)
     */
    getMinimumDuration(sessionId: string): number | null

    /**
     * Check URL triggers on each navigation
     * Note: URL is read from window.location.href internally
     */
    checkUrlTriggers(
        sessionId: string,
        onPause: () => void,
        onResume: () => void,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void
    ): void

    /**
     * Setup event trigger listeners
     */
    setupEventTriggerListeners(
        onEvent: (callback: (event: CaptureResult) => void) => () => void,
        sessionId: string,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void
    ): (() => void) | undefined

    /**
     * Make sampling decisions for the session
     */
    makeSamplingDecisions(sessionId: string): void

    /**
     * Called after the initial buffer flush (performance optimization hook)
     */
    onFlushComplete(): void

    /**
     * Clean up persistence keys for conditional recording
     */
    clearConditionalRecordingPersistence(): void

    /**
     * Update session properties with active trigger information
     */
    updateActiveTriggers(sessionId: string): void

    /**
     * Check if triggers are in pending state (waiting for activation)
     */
    hasPendingTriggers(sessionId: string): boolean

    /**
     * Stop and cleanup the strategy
     */
    stop(): void
}

/**
 * V1 Strategy: Legacy trigger matching with global URL/Event/Flag triggers
 */
export class V1RecordingStrategy implements RecordingStrategy {
    private _triggerStatusMatcher: TriggerStatusMatching | undefined
    private _removeEventTriggerCaptureHook: (() => void) | undefined
    private _sampleRate: number | null = null
    private _recordingStatusFunction: typeof anyMatchSessionRecordingStatus = allMatchSessionRecordingStatus

    constructor(
        private readonly _instance: PostHog,
        private readonly _urlTriggerMatching: URLTriggerMatching,
        private readonly _eventTriggerMatching: EventTriggerMatching,
        private readonly _linkedFlagMatching: LinkedFlagMatching,
        private readonly _reportStarted: (reason: SessionStartReason, payload?: Record<string, any>) => void,
        private readonly _tryTakeFullSnapshot: () => void
    ) {}

    onRemoteConfig(config: SessionRecordingPersistedConfig): void {
        this._sampleRate = isNumber(config.sampleRate) ? config.sampleRate : null

        // Setup trigger matching strategy (AND vs OR)
        if (config.triggerMatchType === 'any') {
            this._triggerStatusMatcher = new OrTriggerMatching([this._eventTriggerMatching, this._urlTriggerMatching])
            this._recordingStatusFunction = anyMatchSessionRecordingStatus
        } else {
            // either the setting is "ALL" or we default to the most restrictive
            this._triggerStatusMatcher = new AndTriggerMatching([this._eventTriggerMatching, this._urlTriggerMatching])
            this._recordingStatusFunction = allMatchSessionRecordingStatus
        }

        this._instance.register_for_session({
            $sdk_debug_replay_remote_trigger_matching_config: config.triggerMatchType,
        })

        this._urlTriggerMatching.onConfig(config)
        this._eventTriggerMatching.onConfig(config)

        this._linkedFlagMatching.onConfig(config, (flag, variant) => {
            this._reportStarted('linked_flag_matched', { flag, variant })
        })
    }

    getStatus(context: RecordingStrategyContext): SessionRecordingStatus {
        return this._recordingStatusFunction({
            receivedFlags: true,
            isRecordingEnabled: true,
            isSampled: context.isSampled,
            rrwebError: context.rrwebError,
            urlTriggerMatching: context.urlTriggerMatching,
            eventTriggerMatching: context.eventTriggerMatching,
            linkedFlagMatching: context.linkedFlagMatching,
            sessionId: context.sessionId,
        })
    }

    getMinimumDuration(sessionId: string): number | null {
        // V1: Minimum duration is global from config, doesn't need sessionId
        void sessionId
        const config = this._instance.get_property('$session_recording_remote_config') as
            | SessionRecordingPersistedConfig
            | undefined
        const duration = config?.minimumDurationMilliseconds
        return isNumber(duration) ? duration : null
    }

    checkUrlTriggers(
        sessionId: string,
        onPause: () => void,
        onResume: () => void,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void
    ): void {
        this._urlTriggerMatching.checkUrlTriggerConditions(onPause, onResume, onActivate, sessionId)
    }

    setupEventTriggerListeners(
        onEvent: (callback: (event: CaptureResult) => void) => () => void,
        sessionId: string,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void
    ): (() => void) | undefined {
        if (this._eventTriggerMatching._eventTriggers.length === 0 || !isNullish(this._removeEventTriggerCaptureHook)) {
            return undefined
        }

        this._removeEventTriggerCaptureHook = onEvent((event: CaptureResult) => {
            try {
                this._eventTriggerMatching.checkEventTriggerConditions(event.event, onActivate, sessionId)
            } catch (e) {
                logger.error('Could not activate event trigger', e)
            }
        })

        return this._removeEventTriggerCaptureHook
    }

    makeSamplingDecisions(sessionId: string): void {
        const currentSampleRate = this._sampleRate

        if (!isNumber(currentSampleRate)) {
            this._instance.persistence?.unregister(SESSION_RECORDING_IS_SAMPLED)
            return
        }

        const storedValue = this._instance.get_property(SESSION_RECORDING_IS_SAMPLED)

        // Parse stored decision:
        // - sessionId string = sampled in for that session
        // - false = sampled out (persistent across navigations in same session)
        // - undefined/null = no decision yet
        const storedIsSampled = storedValue === sessionId ? true : storedValue === false ? false : null

        // Make new decision only if:
        // 1. No stored decision exists (storedIsSampled is null/undefined), OR
        // 2. Session changed (stored sessionId doesn't match current)
        const sessionChanged = typeof storedValue === 'string' && storedValue !== sessionId
        const makeDecision = sessionChanged || !isBoolean(storedIsSampled)
        const shouldSample = makeDecision ? sampleOnProperty(sessionId, currentSampleRate) : storedIsSampled!

        if (makeDecision) {
            if (shouldSample) {
                this._reportStarted('sampled')
            } else {
                logger.warn(
                    `Sample rate (${currentSampleRate}) has determined that this sessionId (${sessionId}) will not be sent to the server.`
                )
            }
        }

        this._instance.persistence?.register({
            [SESSION_RECORDING_IS_SAMPLED]: shouldSample ? sessionId : false,
        })
    }

    onFlushComplete(): void {
        // V1 doesn't use this optimization
    }

    clearConditionalRecordingPersistence(): void {
        this._instance.persistence?.unregister(SESSION_RECORDING_EVENT_TRIGGER_ACTIVATED_SESSION)
        this._instance.persistence?.unregister(SESSION_RECORDING_URL_TRIGGER_ACTIVATED_SESSION)
        this._instance.persistence?.unregister(SESSION_RECORDING_IS_SAMPLED)
        this._instance.persistence?.unregister(SESSION_RECORDING_PAST_MINIMUM_DURATION)
    }

    updateActiveTriggers(sessionId: string): void {
        void sessionId
        // V1 doesn't track active triggers in session properties
    }

    hasPendingTriggers(sessionId: string): boolean {
        return this._triggerStatusMatcher?.triggerStatus(sessionId) === TRIGGER_PENDING
    }

    stop(): void {
        this._removeEventTriggerCaptureHook?.()
        this._removeEventTriggerCaptureHook = undefined
        this._eventTriggerMatching.stop()
        this._urlTriggerMatching.stop()
        this._linkedFlagMatching.stop()
    }
}

/**
 * V2 Strategy: Trigger groups with per-group sampling and union behavior
 */
export class V2TriggerGroupStrategy implements RecordingStrategy {
    private _triggerGroupMatchers: TriggerGroupMatching[] = []
    private _triggerGroupSamplingResults: Map<string, boolean> = new Map()
    private _hasCompletedInitialFlush: boolean = false
    private _removeEventTriggerCaptureHook: (() => void) | undefined

    constructor(
        private readonly _instance: PostHog,
        private readonly _urlTriggerMatching: URLTriggerMatching,
        private readonly _reportStarted: (reason: SessionStartReason, payload?: Record<string, any>) => void,
        private readonly _tryAddCustomEvent: (tag: string, payload: any) => void
    ) {}

    onRemoteConfig(config: SessionRecordingPersistedConfig): void {
        if (!config.triggerGroups || config.triggerGroups.length === 0) {
            logger.warn('[V2Strategy] No trigger groups configured')
            return
        }

        // Setup trigger group matchers
        this._setupTriggerGroups(config.triggerGroups)

        this._instance.register_for_session({
            $sdk_debug_replay_remote_trigger_matching_config: 'v2_trigger_groups',
            $sdk_debug_replay_trigger_groups_count: config.triggerGroups.length,
        })

        // V2 needs URL blocklist (but not URL triggers)
        this._urlTriggerMatching.onConfig(config)
    }

    getStatus(context: RecordingStrategyContext): SessionRecordingStatus {
        return triggerGroupsMatchSessionRecordingStatus({
            receivedFlags: true,
            isRecordingEnabled: true,
            isSampled: context.isSampled,
            rrwebError: context.rrwebError,
            urlTriggerMatching: context.urlTriggerMatching,
            eventTriggerMatching: context.eventTriggerMatching,
            linkedFlagMatching: context.linkedFlagMatching,
            sessionId: context.sessionId,
            triggerGroupMatchers: this._triggerGroupMatchers,
            triggerGroupSamplingResults: this._triggerGroupSamplingResults,
            minimumDuration: this.getMinimumDuration(context.sessionId),
        } as RecordingTriggersStatusV2)
    }

    getMinimumDuration(sessionId: string): number | null {
        let lowestDuration: number | null = null

        for (const matcher of this._triggerGroupMatchers) {
            const groupStatus = matcher.triggerStatus(sessionId)

            // Only consider activated groups - pending groups haven't triggered yet
            if (groupStatus === 'trigger_activated') {
                const groupDuration = matcher.group.minDurationMs
                if (isNumber(groupDuration)) {
                    if (isNull(lowestDuration) || groupDuration < lowestDuration) {
                        lowestDuration = groupDuration
                    }
                }
            }
        }

        return lowestDuration
    }

    checkUrlTriggers(
        sessionId: string,
        onPause: () => void,
        onResume: () => void,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void
    ): void {
        // V2 doesn't use the global onActivate callback - each group activates itself
        void onActivate

        // Check URL blocklist (global, not per-group)
        this._urlTriggerMatching.checkUrlBlocklist(onPause, onResume)

        // Check URL triggers for each group
        for (const matcher of this._triggerGroupMatchers) {
            matcher.checkUrlTriggerConditions(
                onPause,
                onResume,
                (triggerType) => {
                    // Check group-level property filters before activating
                    if (!this._checkGroupLevelProperties(matcher, undefined)) {
                        return
                    }

                    matcher.activateTrigger(triggerType, sessionId)
                    this.updateActiveTriggers(sessionId)
                },
                sessionId
            )
        }
    }

    setupEventTriggerListeners(
        onEvent: (callback: (event: CaptureResult) => void) => () => void,
        sessionId: string,
        onActivate: (triggerType: TriggerType, matchDetail?: string) => void
    ): (() => void) | undefined {
        // V2 doesn't use the global onActivate callback - each group activates itself
        void onActivate

        this._removeEventTriggerCaptureHook = onEvent((event: CaptureResult) => {
            // Performance optimization: Stop checking triggers after initial buffer flush
            if (this._hasCompletedInitialFlush) {
                logger.info('[SessionRecorder] Stopping trigger checks - initial buffer flushed')
                this._removeEventTriggerCaptureHook?.()
                this._removeEventTriggerCaptureHook = undefined
                return
            }

            try {
                // V2: Each group activates its own trigger with per-group persistence
                for (const matcher of this._triggerGroupMatchers) {
                    matcher.checkEventTriggerConditions(
                        event.event,
                        (triggerType) => {
                            // Check group-level property filters
                            if (!this._checkGroupLevelProperties(matcher, event.properties)) {
                                return
                            }

                            // Check per-event property filters
                            const eventTriggers = matcher.group.conditions.events || []
                            const matchedTrigger = eventTriggers.find((t) => t.name === event.event)
                            if (matchedTrigger?.properties && matchedTrigger.properties.length > 0) {
                                const personProperties = this._instance.get_property(STORED_PERSON_PROPERTIES_KEY)
                                if (
                                    !matchTriggerPropertyFilters(
                                        matchedTrigger.properties,
                                        event.properties,
                                        personProperties
                                    )
                                ) {
                                    return
                                }
                            }

                            matcher.activateTrigger(triggerType, sessionId)
                            this.updateActiveTriggers(sessionId)
                        },
                        sessionId
                    )
                }
            } catch (e) {
                logger.error('Could not activate event trigger for trigger groups', e)
            }
        })

        return this._removeEventTriggerCaptureHook
    }

    makeSamplingDecisions(sessionId: string): void {
        for (const matcher of this._triggerGroupMatchers) {
            const group = matcher.group
            const groupId = group.id
            const sampleRate = group.sampleRate

            // Check if we have a stored decision for this group
            const storageKey = SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX + groupId
            const storedValue = this._instance.get_property(storageKey)

            // Parse stored decision:
            // - sessionId string = sampled in for that session
            // - false = sampled out (persistent across navigations in same session)
            // - undefined/null = no decision yet
            const storedDecision = storedValue === sessionId ? true : storedValue === false ? false : null

            // Make new decision only if:
            // 1. No stored decision exists (storedDecision is null/undefined), OR
            // 2. Session changed (stored sessionId doesn't match current)
            const sessionChanged = typeof storedValue === 'string' && storedValue !== sessionId
            const makeDecision = sessionChanged || !isBoolean(storedDecision)
            const shouldSample = makeDecision ? sampleOnProperty(sessionId + groupId, sampleRate) : storedDecision!

            if (makeDecision) {
                this._tryAddCustomEvent('triggerGroupSamplingDecisionMade', {
                    group_id: groupId,
                    group_name: group.name,
                    sampleRate: sampleRate,
                    isSampled: shouldSample,
                })
            }

            // Store the decision
            this._triggerGroupSamplingResults.set(groupId, shouldSample)
            this._instance.persistence?.register({
                [storageKey]: shouldSample ? sessionId : false,
            })
        }

        // After all sampling decisions, register which groups are actively recording
        this.updateActiveTriggers(sessionId)
    }

    onFlushComplete(): void {
        this._hasCompletedInitialFlush = true
    }

    clearConditionalRecordingPersistence(): void {
        this._instance.persistence?.unregister(SESSION_RECORDING_IS_SAMPLED)
        this._instance.persistence?.unregister(SESSION_RECORDING_PAST_MINIMUM_DURATION)

        // V2: Clear per-group trigger keys
        for (const matcher of this._triggerGroupMatchers) {
            const groupId = matcher.group.id
            this._instance.persistence?.unregister(SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX + groupId)
            this._instance.persistence?.unregister(SESSION_RECORDING_TRIGGER_V2_GROUP_URL_PREFIX + groupId)
            this._instance.persistence?.unregister(SESSION_RECORDING_TRIGGER_V2_GROUP_SAMPLING_PREFIX + groupId)
        }
    }

    updateActiveTriggers(sessionId: string): void {
        const recordingGroups: Array<{ id: string; name: string; matched: boolean; sampled: boolean }> = []

        for (const matcher of this._triggerGroupMatchers) {
            const group = matcher.group
            const groupId = group.id
            const triggerStatus = matcher.triggerStatus(sessionId)
            const isMatched = triggerStatus === 'trigger_activated'
            const isSampled = this._triggerGroupSamplingResults.get(groupId) === true

            if (isMatched) {
                recordingGroups.push({
                    id: groupId,
                    name: group.name,
                    matched: true,
                    sampled: isSampled,
                })
            }
        }

        this._instance.register_for_session({
            $sdk_debug_replay_matched_recording_trigger_groups: recordingGroups,
        })
    }

    hasPendingTriggers(sessionId: string): boolean {
        // V2: Check if any group has pending triggers
        for (const matcher of this._triggerGroupMatchers) {
            if (matcher.triggerStatus(sessionId) === TRIGGER_PENDING) {
                return true
            }
        }
        return false
    }

    stop(): void {
        this._removeEventTriggerCaptureHook?.()
        this._removeEventTriggerCaptureHook = undefined
        this._triggerGroupMatchers.forEach((matcher) => matcher.stop())
        this._triggerGroupMatchers = []
        this._triggerGroupSamplingResults.clear()
        this._urlTriggerMatching.stop()
    }

    private _checkGroupLevelProperties(
        matcher: TriggerGroupMatching,
        eventProperties: Record<string, any> | undefined
    ): boolean {
        const groupProperties = matcher.group.conditions.properties
        if (!groupProperties || groupProperties.length === 0) {
            return true
        }
        const personProperties = this._instance.get_property(STORED_PERSON_PROPERTIES_KEY)
        return matchTriggerPropertyFilters(groupProperties, eventProperties, personProperties)
    }

    private _setupTriggerGroups(groups: SessionRecordingTriggerGroup[]) {
        // Clean up existing matchers
        this._triggerGroupMatchers.forEach((matcher) => matcher.stop())
        this._triggerGroupMatchers = []
        this._triggerGroupSamplingResults.clear()

        // Create a matcher for each group
        for (const group of groups) {
            const matcher = new TriggerGroupMatching(this._instance, group, (flag, variant) => {
                this._reportStarted('linked_flag_matched', {
                    flag,
                    variant,
                    group_id: group.id,
                    group_name: group.name,
                })
            })
            this._triggerGroupMatchers.push(matcher)
        }
    }
}
