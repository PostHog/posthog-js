import { addEventListener, entries, extend } from '@posthog/browser-common/utils/general-utils'
import type { ApiResponse, Client, Disposable, Extension } from '@posthog/browser-common'
import {
    FlagsResponse,
    FeatureFlagsCallback,
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureResponse,
    Properties,
    JsonType,
    Compression,
    EarlyAccessFeature,
    RemoteConfigFeatureFlagCallback,
    EarlyAccessFeatureStage,
    FeatureFlagDetail,
    FeatureFlagResult,
    FeatureFlagOptions,
    IsFeatureEnabledOptions,
    OverrideFeatureFlagsOptions,
    FeatureFlagOverrideOptions,
} from './types'
import type { FeatureFlagsConfigSource } from './feature-flags-config'

import {
    PERSISTENCE_EARLY_ACCESS_FEATURES,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_ERRORS,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS,
    ENABLED_FEATURE_FLAGS,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
    FLAG_CALL_REPORTED,
    FLAG_CALL_REPORTED_SESSION_ID,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_OVERRIDE_FEATURE_FLAGS,
    PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS,
} from './constants'

import {
    isUndefined,
    isArray,
    getEnabledFromValue,
    getVariantFromValue,
    parsePayload,
    type Logger,
} from '@posthog/core'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { getTimezone } from '@posthog/browser-common/utils/event-utils'
import { window } from '@posthog/browser-common/utils/globals'
import {
    isStatusZeroFailureCircuitBreakerTripped,
    updateStatusZeroFailureCount,
} from '@posthog/browser-common/utils/request-utils'

const logger = createLogger('[FeatureFlags]')
const forceDebugLogger = createLogger('[FeatureFlags]', { debugEnabled: true })
const FLAG_TIMEOUT_MSG = '" failed. Feature flags didn\'t load in time.'
// Mirrors the event retry queue's status-0 budget: repeated requests that die
// before any HTTP response while the browser reports itself online are usually
// deterministically blocked (ad blocker, CORS, extension). Stop periodic /flags
// refreshes after this many consecutive failures until connectivity changes.
const MAX_CONSECUTIVE_FLAGS_STATUS_ZERO_FAILURES = 3

type MaybePromise<T> = T | Promise<T>

/**
 * Preserve browser-v1's same-tick behavior when a host operation is synchronous while still chaining async hosts.
 * Use this only on paths that were historically synchronous, not after requests or other inherently async work.
 */
const continueWith = <T, R>(result: MaybePromise<T>, callback: (value: T) => MaybePromise<R>): MaybePromise<R> => {
    const promise = result as Promise<T>
    return promise?.then ? promise.then(callback) : callback(result as T)
}

type FeatureFlagsState = {
    [PERSISTENCE_ACTIVE_FEATURE_FLAGS]?: string[]
    [ENABLED_FEATURE_FLAGS]?: Record<string, string | boolean>
    [PERSISTENCE_FEATURE_FLAG_DETAILS]?: Record<string, FeatureFlagDetail>
    [PERSISTENCE_FEATURE_FLAG_PAYLOADS]?: Record<string, JsonType>
    [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]?: string
    [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]?: number
    [PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS]?: boolean
    [PERSISTENCE_FEATURE_FLAG_ERRORS]?: string[]
    [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]?: Record<string, string | boolean>
    [PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS]?: Record<string, JsonType>
    [FLAG_CALL_REPORTED]?: Record<string, string[]>
    [FLAG_CALL_REPORTED_SESSION_ID]?: string
    [STORED_PERSON_PROPERTIES_KEY]?: Properties
    [STORED_GROUP_PROPERTIES_KEY]?: Record<string, Properties>
    [PERSISTENCE_EARLY_ACCESS_FEATURES]?: EarlyAccessFeature[]
}

/**
 * Error type constants for the $feature_flag_error property.
 *
 * These values are sent in analytics events to track flag evaluation failures.
 * They should not be changed without considering impact on existing dashboards
 * and queries that filter on these values.
 */
export const FeatureFlagError = {
    ERRORS_WHILE_COMPUTING: 'errors_while_computing_flags',
    FLAG_MISSING: 'flag_missing',
    QUOTA_LIMITED: 'quota_limited',
    TIMEOUT: 'timeout',
    CONNECTION_ERROR: 'connection_error',
    UNKNOWN_ERROR: 'unknown_error',
    apiError: (status: number | string) => `api_error_${status}`,
} as const

/** Converts an array of flag names to a Record where each flag is set to true. */
const arrayToFlagsRecord = (flags: string[]): Record<string, true> => {
    const flagsObj: Record<string, true> = {}
    for (let i = 0; i < flags.length; i++) {
        flagsObj[flags[i]] = true
    }
    return flagsObj
}

export const filterActiveFeatureFlags = (featureFlags?: Record<string, string | boolean>) => {
    const activeFeatureFlags: Record<string, string | boolean> = {}
    for (const [key, value] of entries(featureFlags || {})) {
        if (value) {
            activeFeatureFlags[key] = value
        }
    }
    return activeFeatureFlags
}

export const parseFlagsResponse = (
    response: Partial<FlagsResponse>,
    currentFlags: Record<string, string | boolean> = {},
    currentFlagPayloads: Record<string, JsonType> = {},
    currentFlagDetails: Record<string, FeatureFlagDetail> = {},
    options?: { partialResponse?: boolean },
    responseLogger: Logger = logger
): FeatureFlagsState | undefined => {
    const normalizedResponse = normalizeFlagsResponse(response, responseLogger)
    const flagDetails = normalizedResponse.flags
    const featureFlags = normalizedResponse.featureFlags
    const flagPayloads = normalizedResponse.featureFlagPayloads

    if (!featureFlags) {
        return // <-- This early return means we don't update anything, which is good.
    }

    const requestId = response['requestId']
    const evaluatedAt = response['evaluatedAt']

    // using the v1 api
    if (isArray(featureFlags)) {
        responseLogger.warn('v1 of the feature flags endpoint is deprecated. Please use the latest version.')
        const $enabled_feature_flags: Record<string, boolean> = {}
        if (featureFlags) {
            for (let i = 0; i < featureFlags.length; i++) {
                $enabled_feature_flags[featureFlags[i]] = true
            }
        }
        return {
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: featureFlags,
            [ENABLED_FEATURE_FLAGS]: $enabled_feature_flags,
            // Legacy responses never carry the gate — fail safe to full events.
            [PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS]: false,
        }
    }

    // using the v2+ api
    let newFeatureFlags = featureFlags
    let newFeatureFlagPayloads = flagPayloads
    let newFeatureFlagDetails = flagDetails
    if (options?.partialResponse) {
        // The response is intentionally partial (e.g., only survey flags were requested via
        // advanced_only_evaluate_survey_feature_flags). Merge with existing flags so that
        // bootstrapped or previously loaded non-survey flags are preserved.
        newFeatureFlags = { ...currentFlags, ...newFeatureFlags }
        newFeatureFlagPayloads = { ...currentFlagPayloads, ...newFeatureFlagPayloads }
        newFeatureFlagDetails = { ...currentFlagDetails, ...newFeatureFlagDetails }
    } else if (response.errorsWhileComputingFlags) {
        // if not all flags were computed, we upsert flags instead of replacing them
        // but filter out flags that failed to evaluate so they don't overwrite cached values
        if (flagDetails) {
            const successfulKeys = new Set(Object.keys(flagDetails).filter((key) => !flagDetails[key]?.failed))

            newFeatureFlags = {
                ...currentFlags,
                ...Object.fromEntries(Object.entries(newFeatureFlags).filter(([key]) => successfulKeys.has(key))),
            }
            newFeatureFlagPayloads = {
                ...currentFlagPayloads,
                ...Object.fromEntries(
                    Object.entries(newFeatureFlagPayloads || {}).filter(([key]) => successfulKeys.has(key))
                ),
            }
            newFeatureFlagDetails = {
                ...currentFlagDetails,
                ...Object.fromEntries(
                    Object.entries(newFeatureFlagDetails || {}).filter(([key]) => successfulKeys.has(key))
                ),
            }
        } else {
            // v1 responses don't have flagDetails, so we can't filter by failed field
            // Fall back to the original merge behavior
            newFeatureFlags = { ...currentFlags, ...newFeatureFlags }
            newFeatureFlagPayloads = { ...currentFlagPayloads, ...newFeatureFlagPayloads }
            newFeatureFlagDetails = { ...currentFlagDetails, ...newFeatureFlagDetails }
        }
    }

    return {
        [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: Object.keys(filterActiveFeatureFlags(newFeatureFlags)),
        [ENABLED_FEATURE_FLAGS]: newFeatureFlags || {},
        [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: newFeatureFlagPayloads || {},
        [PERSISTENCE_FEATURE_FLAG_DETAILS]: newFeatureFlagDetails || {},
        // Overwritten on every flags response: an absent field flips the gate off, so
        // bootstrap/locally injected flags always fail safe to full events.
        [PERSISTENCE_MINIMAL_FLAG_CALLED_EVENTS]: response.minimalFlagCalledEvents === true,
        ...(requestId ? { [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: requestId } : {}),
        ...(evaluatedAt ? { [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: evaluatedAt } : {}),
    }
}

const normalizeFlagsResponse = (response: Partial<FlagsResponse>, responseLogger: Logger): Partial<FlagsResponse> => {
    const flagDetails = response['flags']

    if (flagDetails) {
        // This is a /flags?v=2 request.

        // Map of flag keys to flag values: Record<string, string | boolean>
        const featureFlags = Object.fromEntries(
            Object.keys(flagDetails).map((flag) => [flag, flagDetails[flag].variant ?? flagDetails[flag].enabled])
        )
        // Map of flag keys to flag payloads: Record<string, JsonType>
        const featureFlagPayloads = Object.fromEntries(
            Object.keys(flagDetails)
                .filter((flag) => flagDetails[flag].enabled)
                .filter((flag) => flagDetails[flag].metadata?.payload)
                .map((flag) => [flag, flagDetails[flag].metadata?.payload])
        )
        return { ...response, featureFlags, featureFlagPayloads }
    } else if (response['featureFlags']) {
        // The response has no `flags` key but does carry top-level `featureFlags`, which is the
        // shape returned by older servers that don't understand `?v=2`. A valid v2 response with no
        // flags (e.g. a project without any feature flags) legitimately omits `flags`, so we must
        // not warn in that case.
        responseLogger.warn(
            'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'
        )
    }
    return response
}

export const QuotaLimitedResource = {
    FeatureFlags: 'feature_flags',
    Recordings: 'recordings',
} as const
export type QuotaLimitedResource = (typeof QuotaLimitedResource)[keyof typeof QuotaLimitedResource]

export class PostHogFeatureFlags implements Extension {
    readonly name = 'featureFlags'
    _override_warning: boolean = false
    featureFlagEventHandlers: FeatureFlagsCallback[] = []
    $anon_distinct_id: string | undefined
    private _client?: Client
    private _initializingClient?: Client
    private _logger: Client['logger'] = logger
    private _dynamicProperties?: Disposable
    private _freshEventProperties: Record<string, unknown> = {}
    private _staleEventProperties: Record<string, unknown> = {}
    private _reloadingHandlers: Array<() => void> = []
    private _hasLoadedFlags: boolean = false
    // Latest request wins logically. Superseded transports are not aborted because Client does not expose cancellation yet.
    private _requestInFlight?: Promise<ApiResponse>
    private _reloadingDisabled: boolean = false
    private _reloadDebouncer?: ReturnType<typeof setTimeout>
    private _flagsLoadedFromRemote: boolean = false
    private _staleCacheRefreshTriggered: boolean = false
    private _consecutiveStatusZeroFailures: number = 0

    constructor(private readonly _configSource: FeatureFlagsConfigSource) {}

    setup(client: Client): void | Promise<void> {
        this._initializingClient = client
        this._logger = client.logger.createLogger('[FeatureFlags]')
        return continueWith(client.kv.initialize(), () => {
            if (this._initializingClient !== client) {
                return
            }
            this._initializingClient = undefined
            this._client = client
            this._finishSetup(client)
        })
    }

    private _finishSetup(client: Client): void {
        if (this._client !== client) {
            return
        }
        if (window) {
            addEventListener(window, 'online', this._onOnline)
        }
        this._dynamicProperties = client.registerDynamicEventProperties(() =>
            this._isCacheStale() ? this._staleEventProperties : this._freshEventProperties
        )
        this._rebuildEventProperties()
        return this._initialize()
    }

    private _onOnline = (): void => {
        const wasTripped = this._hasStatusZeroCircuitBreakerTripped()
        this._consecutiveStatusZeroFailures = 0
        if (wasTripped) {
            this.reloadFeatureFlags()
        }
    }

    dispose(): void {
        this._initializingClient = undefined
        if (!this._client) {
            return
        }
        this._clearDebouncer()
        this._requestInFlight = undefined
        this._dynamicProperties?.dispose()
        this._dynamicProperties = undefined
        this._reloadingHandlers = []
        window?.removeEventListener('online', this._onOnline)
        this._client = undefined
    }

    private get _config() {
        return this._configSource.get()
    }

    private _prop<Key extends keyof FeatureFlagsState>(key: Key): FeatureFlagsState[Key] {
        return this._client?.kv.get<FeatureFlagsState[Key]>(key)
    }

    private _set(properties: FeatureFlagsState): void {
        this._persist(() => this._client?.kv.set(properties))
    }

    private _remove(keys: keyof FeatureFlagsState | readonly (keyof FeatureFlagsState)[]): void {
        this._persist(() => this._client?.kv.remove(keys))
    }

    private _persist(operation: () => void): void {
        try {
            operation()
        } catch (error) {
            this._logger.error('Failed to update feature flag persistence', error)
        }
    }

    private _rebuildEventProperties(): void {
        const common: Record<string, unknown> = {}
        for (const key of [
            PERSISTENCE_ACTIVE_FEATURE_FLAGS,
            PERSISTENCE_FEATURE_FLAG_PAYLOADS,
            PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
            PERSISTENCE_OVERRIDE_FEATURE_FLAGS,
        ] as const) {
            const value = this._prop(key)
            if (!isUndefined(value)) {
                common[key] = value
            }
        }
        this._staleEventProperties = common
        const fresh = { ...common }
        const flags = this._prop(ENABLED_FEATURE_FLAGS)
        if (flags) {
            for (const [key, value] of Object.entries(flags)) {
                fresh[`$feature/${key}`] = value
            }
        }
        this._freshEventProperties = fresh
    }

    /**
     * Check if the feature flag cache is stale based on the configured TTL.
     */
    private _isCacheStale(): boolean {
        const ttl = this._config.cacheTtlMs
        if (!ttl || ttl <= 0) {
            return false
        }
        const evaluatedAt = this._prop(PERSISTENCE_FEATURE_FLAG_EVALUATED_AT)
        return typeof evaluatedAt !== 'number' || Date.now() - evaluatedAt > ttl
    }

    /**
     * Triggers a debounced reload when cache staleness is first detected.
     * Returns true if cache is stale, false otherwise.
     */
    private _checkAndTriggerStaleRefresh(): boolean {
        if (!this._isCacheStale()) {
            return false
        }
        // Only trigger refresh once per stale period
        if (!this._staleCacheRefreshTriggered && !this._requestInFlight) {
            this._staleCacheRefreshTriggered = true
            this._logger.warn('Feature flag cache is stale, triggering refresh...')
            this.reloadFeatureFlags()
        }
        return true
    }

    private _getValidEvaluationEnvironments(): string[] {
        const envs = this._config.evaluationContexts

        if (!envs?.length) {
            return []
        }

        return envs.filter((env: string) => {
            const isValid = env && typeof env === 'string' && env.trim().length > 0
            if (!isValid) {
                this._logger.error('Invalid evaluation context found:', env, 'Expected non-empty string')
            }
            return isValid
        })
    }

    private _getValidFlagKeys(): string[] | undefined {
        const flagKeys = this._config.flagKeys

        if (isUndefined(flagKeys)) {
            return undefined
        }

        return flagKeys.filter((flagKey: string) => {
            const isValid = flagKey && typeof flagKey === 'string' && flagKey.trim().length > 0
            if (!isValid) {
                this._logger.error('Invalid flag key found:', flagKey, 'Expected non-empty string')
            }
            return isValid
        })
    }

    private _initialize(): void {
        const config = this._config
        const bootstrapFlags = config.bootstrap?.featureFlags ?? {}
        const hasBootstrappedFlags = Object.keys(bootstrapFlags).length
        if (hasBootstrappedFlags) {
            const bootstrapPayloads = config.bootstrap?.featureFlagPayloads ?? {}
            const activeFlags = Object.keys(bootstrapFlags)
                .filter((flag) => !!bootstrapFlags[flag])
                .reduce((res: Record<string, string | boolean>, key) => {
                    res[key] = bootstrapFlags[key] || false
                    return res
                }, {})
            const featureFlagPayloads = Object.keys(bootstrapPayloads)
                .filter((key) => activeFlags[key])
                .reduce((res: Record<string, JsonType>, key) => {
                    if (bootstrapPayloads[key]) {
                        res[key] = bootstrapPayloads[key]
                    }
                    return res
                }, {})

            return this._receivedFeatureFlags({ featureFlags: activeFlags, featureFlagPayloads })
        }
        return undefined
    }

    updateFlags(
        flags: Record<string, boolean | string>,
        payloads?: Record<string, JsonType>,
        options?: { merge?: boolean }
    ): void {
        // Merge against the raw stored flags/payloads, not the override-applied getters.
        const existingFlags: Record<string, boolean | string> = options?.merge
            ? (this._prop(ENABLED_FEATURE_FLAGS) ?? {})
            : {}
        const existingPayloads: Record<string, JsonType> = options?.merge
            ? (this._prop(PERSISTENCE_FEATURE_FLAG_PAYLOADS) ?? {})
            : {}
        const finalFlags: Record<string, boolean | string> = { ...existingFlags, ...flags }
        const finalPayloads: Record<string, JsonType> = { ...existingPayloads, ...payloads }

        // Convert simple flags to v4 format to avoid deprecation warning
        const flagDetails: Record<string, FeatureFlagDetail> = {}
        for (const [key, value] of Object.entries(finalFlags)) {
            flagDetails[key] = {
                key,
                enabled: getEnabledFromValue(value),
                variant: getVariantFromValue(value),
                reason: undefined,
                // id: 0 indicates manually injected flags (not from server evaluation)
                metadata: !isUndefined(finalPayloads?.[key])
                    ? { id: 0, version: undefined, description: undefined, payload: finalPayloads[key] }
                    : undefined,
            }
        }

        void this._receivedFeatureFlags({
            flags: flagDetails,
        })
    }

    get hasLoadedFlags(): boolean {
        return this._hasLoadedFlags
    }

    getFlags(): string[] {
        return Object.keys(this.getFlagVariants())
    }

    getFlagsWithDetails(): Record<string, FeatureFlagDetail> {
        const flagDetails = this._prop(PERSISTENCE_FEATURE_FLAG_DETAILS)

        const overridenFlags = this._prop(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
        const overriddenPayloads = this._prop(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)

        if (!overriddenPayloads && !overridenFlags) {
            return flagDetails || {}
        }

        const finalDetails = extend({}, flagDetails || {})
        const overriddenKeys = [
            ...new Set([...Object.keys(overriddenPayloads || {}), ...Object.keys(overridenFlags || {})]),
        ]
        for (const key of overriddenKeys) {
            const originalDetail = finalDetails[key]
            const overrideFlagValue = overridenFlags?.[key]

            const finalEnabled = isUndefined(overrideFlagValue)
                ? (originalDetail?.enabled ?? false)
                : !!overrideFlagValue

            const overrideVariant = isUndefined(overrideFlagValue)
                ? originalDetail?.variant
                : typeof overrideFlagValue === 'string'
                  ? overrideFlagValue
                  : undefined

            const overridePayload = overriddenPayloads?.[key]

            const overridenDetail = {
                ...originalDetail,
                enabled: finalEnabled,
                // If the flag is not enabled, the variant should be undefined, even if the original has a variant value.
                variant: finalEnabled ? (overrideVariant ?? originalDetail?.variant) : undefined,
            }

            // Keep track of the original enabled and variant values so we can send them in the $feature_flag_called event.
            // This will be helpful for debugging and for understanding the impact of overrides.
            if (finalEnabled !== originalDetail?.enabled) {
                overridenDetail.original_enabled = originalDetail?.enabled
            }

            if (overrideVariant !== originalDetail?.variant) {
                overridenDetail.original_variant = originalDetail?.variant
            }

            if (overridePayload) {
                overridenDetail.metadata = {
                    ...originalDetail?.metadata,
                    payload: overridePayload,
                    original_payload: originalDetail?.metadata?.payload,
                }
            }

            finalDetails[key] = overridenDetail
        }

        if (!this._override_warning) {
            this._logger.warn(' Overriding feature flag details!', {
                flagDetails,
                overriddenPayloads,
                finalDetails,
            })
            this._override_warning = true
        }
        return finalDetails
    }

    getAllFeatureFlags(): FeatureFlagResult[] {
        const flagVariants = this.getFlagVariants()
        const payloads = this.getFlagPayloads()
        return Object.keys(flagVariants).map((key) => {
            const flagValue = flagVariants[key]
            return {
                key,
                enabled: getEnabledFromValue(flagValue),
                variant: getVariantFromValue(flagValue),
                payload: parsePayload(payloads[key]),
            }
        })
    }

    getFlagVariants(): Record<string, string | boolean> {
        const enabledFlags = this._prop(ENABLED_FEATURE_FLAGS)
        const overriddenFlags = this._prop(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
        if (!overriddenFlags) {
            return enabledFlags || {}
        }

        const finalFlags = extend({}, enabledFlags || {})
        const overriddenKeys = Object.keys(overriddenFlags)
        for (let i = 0; i < overriddenKeys.length; i++) {
            finalFlags[overriddenKeys[i]] = overriddenFlags[overriddenKeys[i]]
        }
        if (!this._override_warning) {
            this._logger.warn(' Overriding feature flags!', {
                enabledFlags,
                overriddenFlags,
                finalFlags,
            })
            this._override_warning = true
        }
        return finalFlags
    }

    getFlagPayloads(): Record<string, JsonType> {
        const flagPayloads = this._prop(PERSISTENCE_FEATURE_FLAG_PAYLOADS)
        const overriddenPayloads = this._prop(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)

        if (!overriddenPayloads) {
            return flagPayloads || {}
        }

        const finalPayloads = extend({}, flagPayloads || {})
        const overriddenKeys = Object.keys(overriddenPayloads)
        for (let i = 0; i < overriddenKeys.length; i++) {
            finalPayloads[overriddenKeys[i]] = overriddenPayloads[overriddenKeys[i]]
        }

        if (!this._override_warning) {
            this._logger.warn(' Overriding feature flag payloads!', {
                flagPayloads,
                overriddenPayloads,
                finalPayloads,
            })
            this._override_warning = true
        }
        return finalPayloads
    }

    /**
     * Reloads feature flags asynchronously.
     *
     * Constraints:
     *
     * 1. Supersede any active request so only the latest response can update state
     * 2. Delay a few milliseconds after each reloadFeatureFlags call to batch subsequent changes together
     */
    reloadFeatureFlags(): void {
        if (this._reloadingDisabled || this._config.featureFlagsDisabled) {
            // If reloading has been explicitly disabled then we don't want to do anything
            // Or if feature flags are disabled
            return
        }

        if (this._hasStatusZeroCircuitBreakerTripped()) {
            return
        }

        if (this._reloadDebouncer) {
            // If we're already in a debounce then we don't want to do anything
            return
        }

        this._requestInFlight = undefined

        // Notify browser-v1 facade listeners before the debounced request starts.
        this._reloadingHandlers.slice().forEach((handler) => {
            try {
                handler()
            } catch (error) {
                this._logger.error('Error while running feature flags reloading callback', error)
            }
        })

        // Debounce multiple calls on the same tick
        this._reloadDebouncer = setTimeout(() => {
            void this._callFlagsEndpoint()
        }, 5)
    }

    private _clearDebouncer(): void {
        clearTimeout(this._reloadDebouncer)
        this._reloadDebouncer = undefined
    }

    onReloading(handler: () => void): () => void {
        this._reloadingHandlers.push(handler)
        return () => {
            this._reloadingHandlers = this._reloadingHandlers.filter((entry) => entry !== handler)
        }
    }

    ensureFlagsLoaded(): void {
        if (this._hasLoadedFlags || this._requestInFlight || this._reloadDebouncer) {
            // If we are or have already loaded the flags then we don't want to do anything
            return
        }

        this.reloadFeatureFlags()
    }

    setAnonymousDistinctId(anon_distinct_id: string): void {
        this.$anon_distinct_id = anon_distinct_id
    }

    setReloadingPaused(isPaused: boolean): void {
        this._reloadingDisabled = isPaused
    }

    resetFlagCallReported(): void {
        this._remove(FLAG_CALL_REPORTED)
    }

    async _callFlagsEndpoint(options?: { disableFlags?: boolean }): Promise<void> {
        this._clearDebouncer()
        const client = this._client
        if (!client || this._config.remoteRequestsDisabled || this._hasStatusZeroCircuitBreakerTripped()) {
            return
        }

        const data: Record<string, any> = {
            token: client.projectToken,
            distinct_id: client.distinctId,
            groups: client.groups,
            $anon_distinct_id: this.$anon_distinct_id,
            person_properties: {
                ...client.initialPersonProperties,
                ...(this._prop(STORED_PERSON_PROPERTIES_KEY) || {}),
                $lib: client.library.name,
                $lib_version: client.library.version,
            },
            group_properties: this._prop(STORED_GROUP_PROPERTIES_KEY),
            timezone: getTimezone(),
        }
        if (!isUndefined(client.deviceId)) {
            data.$device_id = client.deviceId
        }
        if (options?.disableFlags || this._config.featureFlagsDisabled) {
            data.disable_flags = true
        }
        const evaluationContexts = this._getValidEvaluationEnvironments()
        if (evaluationContexts.length) {
            data.evaluation_contexts = evaluationContexts
        }
        const flagKeys = this._getValidFlagKeys()
        if (!isUndefined(flagKeys)) {
            data.flag_keys = flagKeys
        }

        const isPartialFlagsResponse = this._config.onlyEvaluateSurveyFeatureFlags
        const path = `/flags/?v=2${isPartialFlagsResponse ? '&only_evaluate_survey_feature_flags=true' : ''}`
        this._requestInFlight = undefined
        let request: Promise<ApiResponse> | undefined

        try {
            request = client.sendRequest(path, {
                target: 'flags',
                method: 'POST',
                body: data,
                compression: this._config.compression === 'base64' ? Compression.Base64 : undefined,
                sentAt: 'body',
                timeoutMs: this._config.requestTimeoutMs,
            })
            this._requestInFlight = request
            const response = await request
            if (this._requestInFlight !== request) {
                return
            }

            const json = (response.json ?? {}) as Partial<FlagsResponse> & { quotaLimited?: string[] }
            const errorsLoading = response.statusCode !== 200
            this._trackStatusZeroReachability(response.statusCode)
            if (!errorsLoading) {
                this.$anon_distinct_id = undefined
            }
            if (data.disable_flags) {
                return
            }
            this._flagsLoadedFromRemote = !errorsLoading

            const flagErrors: string[] = []
            if (response.error) {
                flagErrors.push(
                    response.error instanceof Error && response.error.name === 'AbortError'
                        ? FeatureFlagError.TIMEOUT
                        : response.error instanceof Error
                          ? FeatureFlagError.CONNECTION_ERROR
                          : FeatureFlagError.UNKNOWN_ERROR
                )
            } else if (response.statusCode !== 200) {
                flagErrors.push(FeatureFlagError.apiError(response.statusCode))
            }
            if (json.errorsWhileComputingFlags) {
                flagErrors.push(FeatureFlagError.ERRORS_WHILE_COMPUTING)
            }
            const isQuotaLimited = !!json.quotaLimited?.includes(QuotaLimitedResource.FeatureFlags)
            if (isQuotaLimited) {
                flagErrors.push(FeatureFlagError.QUOTA_LIMITED)
            }
            this._set({ [PERSISTENCE_FEATURE_FLAG_ERRORS]: flagErrors })

            if (isQuotaLimited) {
                client.logger.warn(
                    'You have hit your feature flags quota limit, and will not be able to load feature flags until the quota is reset.  Please visit https://posthog.com/docs/billing/limits-alerts to learn more.'
                )
                return
            }
            this._receivedFeatureFlags(json, errorsLoading, { partialResponse: isPartialFlagsResponse })
        } catch (error) {
            if (request && this._requestInFlight !== request) {
                return
            }
            this._set({ [PERSISTENCE_FEATURE_FLAG_ERRORS]: [FeatureFlagError.CONNECTION_ERROR] })
            if (!request || this._requestInFlight === request) {
                client.logger.error('Feature flag request failed', error)
            }
        } finally {
            if (request && this._requestInFlight === request) {
                this._requestInFlight = undefined
            }
        }
    }

    private _hasStatusZeroCircuitBreakerTripped(): boolean {
        return isStatusZeroFailureCircuitBreakerTripped(
            this._consecutiveStatusZeroFailures,
            MAX_CONSECUTIVE_FLAGS_STATUS_ZERO_FAILURES
        )
    }

    private _trackStatusZeroReachability(statusCode: number): void {
        this._consecutiveStatusZeroFailures = updateStatusZeroFailureCount(
            statusCode,
            this._consecutiveStatusZeroFailures,
            MAX_CONSECUTIVE_FLAGS_STATUS_ZERO_FAILURES,
            () =>
                this._logger.warn(
                    'Feature flag requests are failing before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped refreshing feature flags; will try again when connectivity changes.'
                )
        )
    }

    /**
     * Get feature flag's value for user.
     *
     * By default, this method may return cached values from localStorage if the `/flags` endpoint
     * hasn't responded yet. This reduces flicker but means you might briefly see stale values
     * (e.g., a flag that was disabled on the server).
     *
     * ### Usage:
     *
     *     if(posthog.getFeatureFlag('my-flag') === 'some-variant') { // do something }
     *
     *     // Only use fresh values from the server (returns undefined until /flags responds)
     *     if(posthog.getFeatureFlag('my-flag', { fresh: true }) === 'some-variant') { // do something }
     *
     * @param {String} key Key of the feature flag.
     * @param {Object} options Optional settings.
     * @param {boolean} [options.send_event=true] If false, won't send a $feature_flag_called event to PostHog.
     * @param {boolean} [options.fresh=false] If true, only returns values loaded from the server, not cached localStorage values.
     *                  Use this when you need to ensure the flag value reflects the current server state,
     *                  such as after disabling a flag. Returns undefined until the /flags endpoint responds.
     * @returns {boolean | string | undefined} The flag value, or undefined if not found or not yet loaded.
     */
    getFeatureFlag(key: string, options: FeatureFlagOptions = {}): boolean | string | undefined {
        if (options.fresh && !this._flagsLoadedFromRemote) {
            return undefined
        }
        if (!this._hasLoadedFlags && !(this.getFlags() && this.getFlags().length > 0)) {
            this._logger.warn('getFeatureFlag for key "' + key + FLAG_TIMEOUT_MSG)
            return undefined
        }
        // Check if cache is stale and trigger refresh if needed
        if (this._checkAndTriggerStaleRefresh()) {
            return undefined
        }
        const result = this.getFeatureFlagResult(key, options)
        return result?.variant ?? result?.enabled
    }

    /*
     * Retrieves the details for a feature flag.
     *
     * ### Usage:
     *
     *     const details = getFeatureFlagDetails("my-flag")
     *     console.log(details.metadata.version)
     *     console.log(details.reason)
     *
     * @param {String} key Key of the feature flag.
     */
    getFeatureFlagDetails(key: string): FeatureFlagDetail | undefined {
        const details = this.getFlagsWithDetails()
        return details[key]
    }

    /**
     * @deprecated Use `getFeatureFlagResult()` instead which properly tracks the feature flag call.
     * `getFeatureFlagPayload()` does not emit the `$feature_flag_called` event which may result in
     * missing analytics. This method will be removed in a future version.
     */
    getFeatureFlagPayload(key: string): JsonType {
        // Don't send event to maintain backwards compatibility - this method never tracked calls
        const result = this.getFeatureFlagResult(key, { send_event: false })
        return result?.payload
    }

    /**
     * Get a feature flag result including both the flag value and payload, while properly tracking the call.
     * This method emits the `$feature_flag_called` event by default.
     *
     * By default, this method may return cached values from localStorage if the `/flags` endpoint
     * hasn't responded yet. This reduces flicker but means you might briefly see stale values
     * (e.g., a flag that was disabled on the server).
     *
     * ### Usage:
     *
     *     const result = posthog.getFeatureFlagResult('my-flag')
     *     if (result?.enabled) {
     *         console.log('Flag is enabled with payload:', result.payload)
     *     }
     *
     *     // Only use fresh values from the server
     *     const freshResult = posthog.getFeatureFlagResult('my-flag', { fresh: true })
     *
     * @param {String} key Key of the feature flag.
     * @param {Object} [options] Options for the feature flag lookup.
     * @param {boolean} [options.send_event=true] If false, won't send the $feature_flag_called event.
     * @param {boolean} [options.fresh=false] If true, only returns values loaded from the server, not cached localStorage values.
     *                  Use this when you need to ensure the flag value reflects the current server state.
     *                  Returns undefined until the /flags endpoint responds.
     * @returns {FeatureFlagResult | undefined} The feature flag result including key, enabled, variant, and payload.
     */
    getFeatureFlagResult(key: string, options: FeatureFlagOptions = {}): FeatureFlagResult | undefined {
        if (options.fresh && !this._flagsLoadedFromRemote) {
            return undefined
        }
        if (!this._hasLoadedFlags && !(this.getFlags() && this.getFlags().length > 0)) {
            this._logger.warn('getFeatureFlagResult for key "' + key + FLAG_TIMEOUT_MSG)
            return undefined
        }
        // Check if cache is stale and trigger refresh if needed
        if (this._checkAndTriggerStaleRefresh()) {
            return undefined
        }

        const flagVariants = this.getFlagVariants()
        const flagExists = key in flagVariants
        const flagValue = flagVariants[key]
        const payloads = this.getFlagPayloads()
        const payload = payloads[key]
        const flagReportValue = String(flagValue)
        const requestId = this._prop(PERSISTENCE_FEATURE_FLAG_REQUEST_ID) || undefined
        const evaluatedAt = this._prop(PERSISTENCE_FEATURE_FLAG_EVALUATED_AT) || undefined
        let flagCallReported: Record<string, string[]> = Object.fromEntries(
            Object.entries((this._prop(FLAG_CALL_REPORTED) || {}) as Record<string, string[]>).map(([flag, values]) => [
                flag,
                [...values],
            ])
        )

        let sessionIdToPersist: string | undefined
        // When session-scoped dedup is enabled, reset the reported flags whenever the session changes.
        if (this._config.deduplicateCallsPerSession) {
            const currentSessionId = this._client?.session.sessionId
            const storedSessionId = this._prop(FLAG_CALL_REPORTED_SESSION_ID)
            if (currentSessionId && currentSessionId !== storedSessionId) {
                flagCallReported = {}
                sessionIdToPersist = currentSessionId
            }
        }

        if (options.send_event || !('send_event' in options)) {
            if (!(key in flagCallReported) || !flagCallReported[key].includes(flagReportValue)) {
                if (isArray(flagCallReported[key])) {
                    flagCallReported[key].push(flagReportValue)
                } else {
                    flagCallReported[key] = [flagReportValue]
                }
                this._set({
                    [FLAG_CALL_REPORTED]: flagCallReported,
                    ...(sessionIdToPersist ? { [FLAG_CALL_REPORTED_SESSION_ID]: sessionIdToPersist } : {}),
                })

                const flagDetails = this.getFeatureFlagDetails(key)
                const errors: string[] = [...(this._prop(PERSISTENCE_FEATURE_FLAG_ERRORS) ?? [])]
                if (isUndefined(flagValue)) {
                    errors.push(FeatureFlagError.FLAG_MISSING)
                }

                const properties: Record<string, any | undefined> = {
                    $feature_flag: key,
                    $feature_flag_response: flagValue,
                    $feature_flag_payload: payload || null,
                    $feature_flag_request_id: requestId,
                    $feature_flag_evaluated_at: evaluatedAt,
                    $feature_flag_bootstrapped_response: this._config.bootstrap?.featureFlags?.[key] || null,
                    $feature_flag_bootstrapped_payload: this._config.bootstrap?.featureFlagPayloads?.[key] || null,
                    // If we haven't yet received a response from the /flags endpoint, we must have used the bootstrapped value
                    $used_bootstrap_value: !this._flagsLoadedFromRemote,
                }

                if (!isUndefined(flagDetails?.metadata?.has_experiment)) {
                    properties.$feature_flag_has_experiment = flagDetails.metadata.has_experiment
                }

                if (!isUndefined(flagDetails?.metadata?.version)) {
                    properties.$feature_flag_version = flagDetails.metadata.version
                }

                const reason = flagDetails?.reason?.description ?? flagDetails?.reason?.code
                if (reason) {
                    properties.$feature_flag_reason = reason
                }

                if (flagDetails?.metadata?.id) {
                    properties.$feature_flag_id = flagDetails.metadata.id
                }

                // It's possible that flag values were overridden by calling overrideFeatureFlags.
                // We want to capture the original values in case someone forgets they were using overrides
                // and is wondering why their app is acting weird.
                if (!isUndefined(flagDetails?.original_variant) || !isUndefined(flagDetails?.original_enabled)) {
                    properties.$feature_flag_original_response = !isUndefined(flagDetails.original_variant)
                        ? flagDetails.original_variant
                        : flagDetails.original_enabled
                }

                if (flagDetails?.metadata?.original_payload) {
                    properties.$feature_flag_original_payload = flagDetails?.metadata?.original_payload
                }

                if (errors.length) {
                    properties.$feature_flag_error = errors.join(',')
                }

                this._captureFeatureFlagCalled(properties)
            } else if (sessionIdToPersist) {
                this._set({
                    [FLAG_CALL_REPORTED]: flagCallReported,
                    [FLAG_CALL_REPORTED_SESSION_ID]: sessionIdToPersist,
                })
            }
        } else if (sessionIdToPersist) {
            this._set({
                [FLAG_CALL_REPORTED]: flagCallReported,
                [FLAG_CALL_REPORTED_SESSION_ID]: sessionIdToPersist,
            })
        }

        if (!flagExists) {
            return undefined
        }

        return {
            key,
            enabled: !!flagValue,
            variant: typeof flagValue === 'string' ? flagValue : undefined,
            payload: parsePayload(payload),
        }
    }

    private _captureFeatureFlagCalled(properties: Record<string, any | undefined>): void {
        try {
            void this._client?.capture('$feature_flag_called', properties).catch((error) => {
                this._logger.error('Failed to capture feature flag call', error)
            })
        } catch (error) {
            this._logger.error('Failed to capture feature flag call', error)
        }
    }

    /*
     * Fetches the payload for a remote config feature flag. This method will bypass any cached values and fetch the latest
     * value from the PostHog API.
     *
     * Note: Because the posthog-js SDK is primarily used with public project API keys, encrypted remote config payloads will
     * be redacted, never decrypted in the response.
     *
     * ### Usage:
     *
     *     getRemoteConfigPayload("home-page-welcome-message", (payload) => console.log(`Fetched remote config: ${payload}`))
     *
     * @param {String} key Key of the feature flag.
     * @param {Function} [callback] The callback function will be called once the remote config feature flag payload has been fetched.
     */
    getRemoteConfigPayload(key: string, callback: RemoteConfigFeatureFlagCallback): void {
        void this._getRemoteConfigPayload(key, callback)
    }

    private async _getRemoteConfigPayload(key: string, callback: RemoteConfigFeatureFlagCallback): Promise<void> {
        const client = this._client
        if (!client || this._config.remoteRequestsDisabled) {
            return
        }
        const data: Record<string, any> = {
            distinct_id: client.distinctId,
            token: client.projectToken,
            person_properties: { $lib: client.library.name, $lib_version: client.library.version },
        }
        const evaluationContexts = this._getValidEvaluationEnvironments()
        if (evaluationContexts.length) {
            data.evaluation_contexts = evaluationContexts
        }
        const flagKeys = this._getValidFlagKeys()
        if (!isUndefined(flagKeys)) {
            data.flag_keys = flagKeys
        }
        try {
            const response = await client.sendRequest('/flags/?v=2', {
                target: 'flags',
                method: 'POST',
                body: data,
                compression: this._config.compression === 'base64' ? Compression.Base64 : undefined,
                sentAt: 'body',
                timeoutMs: this._config.requestTimeoutMs,
            })
            const payloads = (response.json as Partial<FlagsResponse> | undefined)?.featureFlagPayloads
            callback(payloads?.[key] || undefined)
        } catch (error) {
            this._logger.error('Remote config feature flag request failed', error)
        }
    }

    /**
     * See if feature flag is enabled for user.
     *
     * By default, this method may return cached values from localStorage if the `/flags` endpoint
     * hasn't responded yet. This reduces flicker but means you might briefly see stale values
     * (e.g., a flag that was disabled on the server).
     *
     * ### Usage:
     *
     *     if(posthog.isFeatureEnabled('beta-feature')) { // do something }
     *
     *     // Only use fresh values from the server
     *     if(posthog.isFeatureEnabled('beta-feature', { fresh: true })) { // do something }
     *
     * @param {String} key Key of the feature flag.
     * @param {Object} [options] Optional settings.
     * @param {boolean} [options.send_event=true] If false, won't send a $feature_flag_called event to PostHog.
     * @param {boolean} [options.fresh=false] If true, only returns values loaded from the server, not cached localStorage values.
     *                  Use this when you need to ensure the flag value reflects the current server state.
     *                  Returns undefined until the /flags endpoint responds.
     * @param {boolean} [options.defaultValue] Value to return when the flag has no value, e.g. flags have not loaded yet or no flag with that key exists.
     * @returns {boolean | undefined} Whether the flag is enabled; when the flag has no value, defaultValue if given, otherwise undefined.
     */
    isFeatureEnabled(key: string, options: IsFeatureEnabledOptions & { defaultValue: boolean }): boolean
    isFeatureEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined
    isFeatureEnabled(key: string, options: IsFeatureEnabledOptions = {}): boolean | undefined {
        if (options.fresh && !this._flagsLoadedFromRemote) {
            return options.defaultValue
        }
        if (!this._hasLoadedFlags && !(this.getFlags() && this.getFlags().length > 0)) {
            this._logger.warn('isFeatureEnabled for key "' + key + FLAG_TIMEOUT_MSG)
            return options.defaultValue
        }
        const flagValue = this.getFeatureFlag(key, options)
        return isUndefined(flagValue) ? options.defaultValue : !!flagValue
    }

    addFeatureFlagsHandler(handler: FeatureFlagsCallback): void {
        this.featureFlagEventHandlers.push(handler)
    }

    removeFeatureFlagsHandler(handler: FeatureFlagsCallback): void {
        this.featureFlagEventHandlers = this.featureFlagEventHandlers.filter((h) => h !== handler)
    }

    receivedFeatureFlags(
        response: Partial<FlagsResponse>,
        errorsLoading?: boolean,
        options?: { partialResponse?: boolean }
    ): void {
        void this._receivedFeatureFlags(response, errorsLoading, options)
    }

    private _receivedFeatureFlags(
        response: Partial<FlagsResponse>,
        errorsLoading?: boolean,
        options?: { partialResponse?: boolean }
    ): void {
        if (!this._client) {
            return
        }
        this._hasLoadedFlags = true

        const currentFlags = this.getFlagVariants()
        const currentFlagPayloads = this.getFlagPayloads()
        const currentFlagDetails = this.getFlagsWithDetails()
        const statePatch = parseFlagsResponse(
            response,
            currentFlags,
            currentFlagPayloads,
            currentFlagDetails,
            options,
            this._logger
        )
        if (statePatch) {
            this._set(statePatch)
        }
        // Reset stale refresh flag when we successfully receive fresh flags
        if (!errorsLoading) {
            this._staleCacheRefreshTriggered = false
        }
        this._fireFeatureFlagsCallbacks(errorsLoading)
    }

    /**
     * @deprecated Use overrideFeatureFlags instead. This will be removed in a future version.
     */
    override(flags: boolean | string[] | Record<string, string | boolean>, suppressWarning: boolean = false): void {
        this._logger.warn('override is deprecated. Please use overrideFeatureFlags instead.')
        this.overrideFeatureFlags({
            flags: flags,
            suppressWarning: suppressWarning,
        })
    }

    /**
     * Override feature flags on the client-side. Useful for setting non-persistent feature flags,
     * or for testing/debugging feature flags in the PostHog app.
     *
     * ### Usage:
     *
     *     - posthog.featureFlags.overrideFeatureFlags(false) // clear all overrides
     *     - posthog.featureFlags.overrideFeatureFlags(['beta-feature']) // enable flags
     *     - posthog.featureFlags.overrideFeatureFlags({'beta-feature': 'variant'}) // set variants
     *     - posthog.featureFlags.overrideFeatureFlags({ flags: ['beta-feature'] }) // enable flags
     *     - posthog.featureFlags.overrideFeatureFlags({ flags: {'beta-feature': 'variant'} }) // set variants
     *     - posthog.featureFlags.overrideFeatureFlags({ // set both flags and payloads
     *         flags: {'beta-feature': 'variant'},
     *         payloads: { 'beta-feature': { someData: true } }
     *       })
     *     - posthog.featureFlags.overrideFeatureFlags({ // only override payloads
     *         payloads: { 'beta-feature': { someData: true } }
     *       })
     */
    overrideFeatureFlags(overrideOptions: OverrideFeatureFlagsOptions): void {
        this._overrideFeatureFlags(overrideOptions)
    }

    private _overrideFeatureFlags(overrideOptions: OverrideFeatureFlagsOptions): void {
        if (!this._client) {
            this._logger.warn('posthog.featureFlags.overrideFeatureFlags called before feature flags were ready')
            return
        }

        // Clear all overrides if false, lets you do something like posthog.featureFlags.overrideFeatureFlags(false)
        if (overrideOptions === false) {
            this._remove([PERSISTENCE_OVERRIDE_FEATURE_FLAGS, PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS])
            this._fireFeatureFlagsCallbacks()
            forceDebugLogger.info('All overrides cleared')
            return
        }

        // Array syntax: ['flag-a', 'flag-b'] -> { 'flag-a': true, 'flag-b': true }
        if (isArray(overrideOptions)) {
            this._set({ [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: arrayToFlagsRecord(overrideOptions) })
            this._fireFeatureFlagsCallbacks()
            forceDebugLogger.info('Flag overrides set', { flags: overrideOptions })
            return
        }

        if (
            overrideOptions &&
            typeof overrideOptions === 'object' &&
            ('flags' in overrideOptions || 'payloads' in overrideOptions)
        ) {
            const options = overrideOptions as FeatureFlagOverrideOptions
            this._override_warning = Boolean(options.suppressWarning ?? false)
            const statePatch: FeatureFlagsState = {}
            const flags = options.flags as false | string[] | Record<string, string | boolean> | undefined
            const payloads = options.payloads as false | Record<string, JsonType> | undefined

            // Handle flags if provided, lets you do something like posthog.featureFlags.overrideFeatureFlags({flags: ['beta-feature']})
            if (flags) {
                statePatch[PERSISTENCE_OVERRIDE_FEATURE_FLAGS] = isArray(flags) ? arrayToFlagsRecord(flags) : flags
            }

            // Handle payloads independently, lets you do something like posthog.featureFlags.overrideFeatureFlags({payloads: { 'beta-feature': { someData: true } }})
            if (payloads) {
                statePatch[PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS] = payloads
            }

            if (Object.keys(statePatch).length) {
                this._set(statePatch)
            }
            if (flags === false && payloads === false) {
                this._remove([PERSISTENCE_OVERRIDE_FEATURE_FLAGS, PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS])
            } else if (flags === false) {
                this._remove(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
            } else if (payloads === false) {
                this._remove(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)
            }
            this._fireFeatureFlagsCallbacks()
            if (flags === false) {
                forceDebugLogger.info('Flag overrides cleared')
            } else if (flags) {
                forceDebugLogger.info('Flag overrides set', { flags })
            }
            if (payloads === false) {
                forceDebugLogger.info('Payload overrides cleared')
            } else if (payloads) {
                forceDebugLogger.info('Payload overrides set', { payloads })
            }
            return
        }

        // Fallback: treat as Record<string, string | boolean>, e.g. {'beta-feature': 'variant'}
        if (overrideOptions && typeof overrideOptions === 'object') {
            this._set({
                [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: overrideOptions as Record<string, string | boolean>,
            })
            this._fireFeatureFlagsCallbacks()
            forceDebugLogger.info('Flag overrides set', { flags: overrideOptions })
            return
        }

        this._logger.warn('Invalid overrideOptions provided to overrideFeatureFlags', { overrideOptions })
    }

    /*
     * Register an event listener that runs when feature flags become available or when they change.
     * If there are flags, the listener is called immediately in addition to being called on future changes.
     *
     * ### Usage:
     *
     *     posthog.onFeatureFlags(function(featureFlags, featureFlagsVariants, { errorsLoading }) { // do something })
     *
     * @param {Function} [callback] The callback function will be called once the feature flags are ready or when they are updated.
     *                              It'll return a list of feature flags enabled for the user, the variants,
     *                              and also a context object indicating whether we succeeded to fetch the flags or not.
     * @returns {Function} A function that can be called to unsubscribe the listener. Used by useEffect when the component unmounts.
     */
    onFeatureFlags(callback: FeatureFlagsCallback): () => void {
        this.addFeatureFlagsHandler(callback)
        if (this._hasLoadedFlags) {
            const { flags, flagVariants } = this._prepareFeatureFlagsForCallbacks()
            // Isolate the callback so a user-provided handler that throws surfaces as a logged
            // error rather than propagating out of onFeatureFlags as a posthog-js SDK error.
            try {
                callback(flags, flagVariants)
            } catch (error) {
                this._logger.error('Error while running feature flags callback', error)
            }
        }
        return () => this.removeFeatureFlagsHandler(callback)
    }

    updateEarlyAccessFeatureEnrollment(key: string, isEnrolled: boolean, stage?: string): void {
        const existing_early_access_features: EarlyAccessFeature[] = this._prop(PERSISTENCE_EARLY_ACCESS_FEATURES) || []
        const feature = existing_early_access_features.find((f) => f.flagKey === key)

        const enrollmentPersonProp = {
            [`$feature_enrollment/${key}`]: isEnrolled,
        }

        const properties: Properties = {
            $feature_flag: key,
            $feature_enrollment: isEnrolled,
            $set: enrollmentPersonProp,
        }

        if (feature) {
            properties['$early_access_feature_name'] = feature.name
        }

        if (stage) {
            properties['$feature_enrollment_stage'] = stage
        }

        const newFlags = { ...this.getFlagVariants(), [key]: isEnrolled }
        this._set({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: Object.keys(filterActiveFeatureFlags(newFlags)),
            [ENABLED_FEATURE_FLAGS]: newFlags,
            [STORED_PERSON_PROPERTIES_KEY]: {
                ...(this._prop(STORED_PERSON_PROPERTIES_KEY) || {}),
                ...enrollmentPersonProp,
            },
        })
        this._fireFeatureFlagsCallbacks()
        try {
            void this._client?.capture('$feature_enrollment_update', properties).catch((error) => {
                this._logger.error('Failed to capture early access feature enrollment', error)
            })
        } catch (error) {
            this._logger.error('Failed to capture early access feature enrollment', error)
        }
    }

    getEarlyAccessFeatures(
        callback: EarlyAccessFeatureCallback,
        force_reload = false,
        stages?: EarlyAccessFeatureStage[]
    ): void {
        const existing_early_access_features = this._prop(PERSISTENCE_EARLY_ACCESS_FEATURES)
        if (existing_early_access_features && !force_reload) {
            callback(existing_early_access_features)
            return
        }
        void this._getEarlyAccessFeatures(callback, stages)
    }

    private async _getEarlyAccessFeatures(
        callback: EarlyAccessFeatureCallback,
        stages?: EarlyAccessFeatureStage[]
    ): Promise<void> {
        const client = this._client
        if (!client || this._config.remoteRequestsDisabled) {
            return
        }
        const stageParams = stages ? `&${stages.map((s) => `stage=${s}`).join('&')}` : ''
        try {
            const response = await client.sendRequest(
                `/api/early_access_features/?token=${client.projectToken}${stageParams}`,
                {
                    target: 'api',
                    method: 'GET',
                    sentAt: 'query',
                }
            )
            if (!response.json) {
                return
            }
            const earlyAccessFeatures = (response.json as EarlyAccessFeatureResponse).earlyAccessFeatures
            this._set({ [PERSISTENCE_EARLY_ACCESS_FEATURES]: earlyAccessFeatures })
            callback(earlyAccessFeatures)
        } catch (error) {
            this._logger.error('Early access feature request failed', error)
        }
    }

    _prepareFeatureFlagsForCallbacks(): { flags: string[]; flagVariants: Record<string, string | boolean> } {
        const flags = this.getFlags()
        const flagVariants = this.getFlagVariants()

        // Return truthy
        const truthyFlags = flags.filter((flag) => flagVariants[flag])
        const truthyFlagVariants = Object.keys(flagVariants)
            .filter((variantKey) => flagVariants[variantKey])
            .reduce((res: Record<string, string | boolean>, key) => {
                res[key] = flagVariants[key]
                return res
            }, {})

        return {
            flags: truthyFlags,
            flagVariants: truthyFlagVariants,
        }
    }

    _fireFeatureFlagsCallbacks(errorsLoading?: boolean): void {
        this._rebuildEventProperties()
        const { flags, flagVariants } = this._prepareFeatureFlagsForCallbacks()
        this.featureFlagEventHandlers.forEach((handler) => {
            // Isolate each handler: a user-provided onFeatureFlags callback that throws must not
            // break the callback chain (preventing later handlers from firing) or surface as a
            // posthog-js SDK error in error tracking.
            try {
                handler(flags, flagVariants, { errorsLoading })
            } catch (error) {
                this._logger.error('Error while running feature flags callback', error)
            }
        })
    }

    /**
     * Set override person properties for feature flags.
     * This is used when dealing with new persons / where you don't want to wait for ingestion
     * to update user properties.
     */
    setPersonPropertiesForFlags(properties: Properties, reloadFeatureFlags = true): void {
        this._setPersonPropertiesForFlags(properties, reloadFeatureFlags)
    }

    private _setPersonPropertiesForFlags(properties: Properties, reloadFeatureFlags = true): void {
        const existingProperties = this._prop(STORED_PERSON_PROPERTIES_KEY) || {}

        // If the caller passes { $set, $set_once }, split them apart so we can apply $set_once
        // semantics (skip keys that already exist). Otherwise treat all properties as $set for
        // backward compatibility with the public API.
        const propsToSet = properties?.['$set'] || (!properties?.['$set_once'] ? properties : {})
        const propsToSetOnce = properties?.['$set_once']

        const setOnceProps: Properties = {}
        if (propsToSetOnce) {
            for (const key in propsToSetOnce) {
                if (Object.prototype.hasOwnProperty.call(propsToSetOnce, key)) {
                    if (!(key in existingProperties)) {
                        setOnceProps[key] = propsToSetOnce[key]
                    }
                }
            }
        }

        this._set({
            [STORED_PERSON_PROPERTIES_KEY]: {
                ...existingProperties,
                ...setOnceProps,
                ...propsToSet,
            },
        })
        if (reloadFeatureFlags) {
            this.reloadFeatureFlags()
        }
    }

    /**
     * Remove override person properties used for feature flags.
     * This is the counterpart to setPersonPropertiesForFlags, used when person properties
     * are unset so flags re-evaluate without the removed values.
     */
    unsetPersonPropertiesForFlags(propertyNames: string[], reloadFeatureFlags = true): void {
        this._unsetPersonPropertiesForFlags(propertyNames, reloadFeatureFlags)
    }

    private _unsetPersonPropertiesForFlags(propertyNames: string[], reloadFeatureFlags = true): void {
        const existingProperties = this._prop(STORED_PERSON_PROPERTIES_KEY) || {}

        const nextProperties: Properties = { ...existingProperties }
        propertyNames.forEach((name) => {
            delete nextProperties[name]
        })

        this._set({ [STORED_PERSON_PROPERTIES_KEY]: nextProperties })
        if (reloadFeatureFlags) {
            this.reloadFeatureFlags()
        }
    }

    resetPersonPropertiesForFlags(reloadFeatureFlags = true): void {
        this._remove(STORED_PERSON_PROPERTIES_KEY)
        if (reloadFeatureFlags) {
            this.reloadFeatureFlags()
        }
    }

    /**
     * Set override group properties for feature flags.
     * This is used when dealing with new groups / where you don't want to wait for ingestion
     * to update properties.
     * Takes in an object, the key of which is the group type.
     * For example:
     *     setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } })
     */
    setGroupPropertiesForFlags(properties: { [type: string]: Properties }, reloadFeatureFlags = true): void {
        this._setGroupPropertiesForFlags(properties, reloadFeatureFlags)
    }

    private _setGroupPropertiesForFlags(properties: { [type: string]: Properties }, reloadFeatureFlags = true): void {
        const existingProperties = (this._prop(STORED_GROUP_PROPERTIES_KEY) || {}) as Record<string, Properties>
        const nextProperties: Record<string, Properties> = { ...existingProperties }
        for (const groupType of Object.keys(properties)) {
            nextProperties[groupType] = { ...existingProperties[groupType], ...properties[groupType] }
        }

        this._set({ [STORED_GROUP_PROPERTIES_KEY]: nextProperties })
        if (reloadFeatureFlags) {
            this.reloadFeatureFlags()
        }
    }

    resetGroupPropertiesForFlags(group_type?: string): void {
        if (group_type) {
            const existingProperties = this._prop(STORED_GROUP_PROPERTIES_KEY) || {}
            this._set({
                [STORED_GROUP_PROPERTIES_KEY]: { ...existingProperties, [group_type]: {} },
            })
        } else {
            this._remove(STORED_GROUP_PROPERTIES_KEY)
        }
    }

    reset(): void {
        this._rebuildEventProperties()
        this._hasLoadedFlags = false
        this._requestInFlight = undefined
        this._reloadingDisabled = false
        this._flagsLoadedFromRemote = false
        this.$anon_distinct_id = undefined
        this._clearDebouncer()
        this._override_warning = false
        this._consecutiveStatusZeroFailures = 0
    }
}
