import { entries, extend } from './utils'
import { PostHog } from './posthog-core'
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
} from './types'
import { PostHogPersistence } from './posthog-persistence'

import {
    PERSISTENCE_EARLY_ACCESS_FEATURES,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    ENABLED_FEATURE_FLAGS,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
    FLAG_CALL_REPORTED,
} from './constants'

import { isUndefined, isArray } from '@posthog/core'
import { createLogger } from './utils/logger'
import { getTimezone } from './utils/event-utils'

const logger = createLogger('[FeatureFlags]')

const PERSISTENCE_ACTIVE_FEATURE_FLAGS = '$active_feature_flags'
const PERSISTENCE_OVERRIDE_FEATURE_FLAGS = '$override_feature_flags'
const PERSISTENCE_FEATURE_FLAG_PAYLOADS = '$feature_flag_payloads'
const PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS = '$override_feature_flag_payloads'
const PERSISTENCE_FEATURE_FLAG_REQUEST_ID = '$feature_flag_request_id'

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
    persistence: PostHogPersistence,
    currentFlags: Record<string, string | boolean> = {},
    currentFlagPayloads: Record<string, JsonType> = {},
    currentFlagDetails: Record<string, FeatureFlagDetail> = {}
) => {
    const normalizedResponse = normalizeFlagsResponse(response)
    const flagDetails = normalizedResponse.flags
    const featureFlags = normalizedResponse.featureFlags
    const flagPayloads = normalizedResponse.featureFlagPayloads

    if (!featureFlags) {
        return // <-- This early return means we don't update anything, which is good.
    }

    const requestId = response['requestId']

    // using the v1 api
    if (isArray(featureFlags)) {
        logger.warn('v1 of the feature flags endpoint is deprecated. Please use the latest version.')
        const $enabled_feature_flags: Record<string, boolean> = {}
        if (featureFlags) {
            for (let i = 0; i < featureFlags.length; i++) {
                $enabled_feature_flags[featureFlags[i]] = true
            }
        }
        persistence &&
            persistence.register({
                [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: featureFlags,
                [ENABLED_FEATURE_FLAGS]: $enabled_feature_flags,
            })
        return
    }

    // using the v2+ api
    let newFeatureFlags = featureFlags
    let newFeatureFlagPayloads = flagPayloads
    let newFeatureFlagDetails = flagDetails
    if (response.errorsWhileComputingFlags) {
        // if not all flags were computed, we upsert flags instead of replacing them
        newFeatureFlags = { ...currentFlags, ...newFeatureFlags }
        newFeatureFlagPayloads = { ...currentFlagPayloads, ...newFeatureFlagPayloads }
        newFeatureFlagDetails = { ...currentFlagDetails, ...newFeatureFlagDetails }
    }

    persistence &&
        persistence.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: Object.keys(filterActiveFeatureFlags(newFeatureFlags)),
            [ENABLED_FEATURE_FLAGS]: newFeatureFlags || {},
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: newFeatureFlagPayloads || {},
            [PERSISTENCE_FEATURE_FLAG_DETAILS]: newFeatureFlagDetails || {},
            ...(requestId ? { [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: requestId } : {}),
        })
}

const normalizeFlagsResponse = (response: Partial<FlagsResponse>): Partial<FlagsResponse> => {
    const flagDetails = response['flags']

    if (flagDetails) {
        // This is a v=4 request.

        // Map of flag keys to flag values: Record<string, string | boolean>
        response.featureFlags = Object.fromEntries(
            Object.keys(flagDetails).map((flag) => [flag, flagDetails[flag].variant ?? flagDetails[flag].enabled])
        )
        // Map of flag keys to flag payloads: Record<string, JsonType>
        response.featureFlagPayloads = Object.fromEntries(
            Object.keys(flagDetails)
                .filter((flag) => flagDetails[flag].enabled)
                .filter((flag) => flagDetails[flag].metadata?.payload)
                .map((flag) => [flag, flagDetails[flag].metadata?.payload])
        )
    } else {
        logger.warn(
            'Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version'
        )
    }
    return response
}

type FeatureFlagOverrides = {
    [flagName: string]: string | boolean
}

type FeatureFlagPayloadOverrides = {
    [flagName: string]: JsonType
}

type FeatureFlagOverrideOptions = {
    flags?: boolean | string[] | FeatureFlagOverrides
    payloads?: FeatureFlagPayloadOverrides
    suppressWarning?: boolean
}

type OverrideFeatureFlagsOptions =
    | boolean // clear all overrides
    | string[] // enable list of flags
    | FeatureFlagOverrides // set variants directly
    | FeatureFlagOverrideOptions

export enum QuotaLimitedResource {
    FeatureFlags = 'feature_flags',
    Recordings = 'recordings',
}

export class PostHogFeatureFlags {
    _override_warning: boolean = false
    featureFlagEventHandlers: FeatureFlagsCallback[]
    $anon_distinct_id: string | undefined
    private _hasLoadedFlags: boolean = false
    private _requestInFlight: boolean = false
    private _reloadingDisabled: boolean = false
    private _additionalReloadRequested: boolean = false
    private _reloadDebouncer?: any
    private _flagsCalled: boolean = false
    private _flagsLoadedFromRemote: boolean = false

    constructor(private _instance: PostHog) {
        this.featureFlagEventHandlers = []
    }

    private _getValidEvaluationEnvironments(): string[] {
        const envs = this._instance.config.evaluation_environments
        if (!envs?.length) {
            return []
        }

        return envs.filter((env) => {
            const isValid = env && typeof env === 'string' && env.trim().length > 0
            if (!isValid) {
                logger.error('Invalid evaluation environment found:', env, 'Expected non-empty string')
            }
            return isValid
        })
    }

    private _shouldIncludeEvaluationEnvironments(): boolean {
        return this._getValidEvaluationEnvironments().length > 0
    }

    flags(): void {
        if (this._instance.config.__preview_remote_config) {
            // If remote config is enabled we don't call /flags and we mark it as called so that we don't simulate it
            this._flagsCalled = true
            return
        }

        // TRICKY: We want to disable flags if we don't have a queued reload, and one of the settings exist for disabling on first load
        const disableFlags =
            !this._reloadDebouncer &&
            (this._instance.config.advanced_disable_feature_flags ||
                this._instance.config.advanced_disable_feature_flags_on_first_load)

        this._callFlagsEndpoint({
            disableFlags,
        })
    }

    get hasLoadedFlags(): boolean {
        return this._hasLoadedFlags
    }

    getFlags(): string[] {
        return Object.keys(this.getFlagVariants())
    }

    getFlagsWithDetails(): Record<string, FeatureFlagDetail> {
        const flagDetails = this._instance.get_property(PERSISTENCE_FEATURE_FLAG_DETAILS)

        const overridenFlags = this._instance.get_property(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
        const overriddenPayloads = this._instance.get_property(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)

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
                ? originalDetail.variant
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
            logger.warn(' Overriding feature flag details!', {
                flagDetails,
                overriddenPayloads,
                finalDetails,
            })
            this._override_warning = true
        }
        return finalDetails
    }

    getFlagVariants(): Record<string, string | boolean> {
        const enabledFlags = this._instance.get_property(ENABLED_FEATURE_FLAGS)
        const overriddenFlags = this._instance.get_property(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
        if (!overriddenFlags) {
            return enabledFlags || {}
        }

        const finalFlags = extend({}, enabledFlags)
        const overriddenKeys = Object.keys(overriddenFlags)
        for (let i = 0; i < overriddenKeys.length; i++) {
            finalFlags[overriddenKeys[i]] = overriddenFlags[overriddenKeys[i]]
        }
        if (!this._override_warning) {
            logger.warn(' Overriding feature flags!', {
                enabledFlags,
                overriddenFlags,
                finalFlags,
            })
            this._override_warning = true
        }
        return finalFlags
    }

    getFlagPayloads(): Record<string, JsonType> {
        const flagPayloads = this._instance.get_property(PERSISTENCE_FEATURE_FLAG_PAYLOADS)
        const overriddenPayloads = this._instance.get_property(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)

        if (!overriddenPayloads) {
            return flagPayloads || {}
        }

        const finalPayloads = extend({}, flagPayloads || {})
        const overriddenKeys = Object.keys(overriddenPayloads)
        for (let i = 0; i < overriddenKeys.length; i++) {
            finalPayloads[overriddenKeys[i]] = overriddenPayloads[overriddenKeys[i]]
        }

        if (!this._override_warning) {
            logger.warn(' Overriding feature flag payloads!', {
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
     * 1. Avoid parallel requests
     * 2. Delay a few milliseconds after each reloadFeatureFlags call to batch subsequent changes together
     */
    reloadFeatureFlags(): void {
        if (this._reloadingDisabled || this._instance.config.advanced_disable_feature_flags) {
            // If reloading has been explicitly disabled then we don't want to do anything
            // Or if feature flags are disabled
            return
        }

        if (this._reloadDebouncer) {
            // If we're already in a debounce then we don't want to do anything
            return
        }

        // Debounce multiple calls on the same tick
        this._reloadDebouncer = setTimeout(() => {
            this._callFlagsEndpoint()
        }, 5)
    }

    private _clearDebouncer(): void {
        clearTimeout(this._reloadDebouncer)
        this._reloadDebouncer = undefined
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

    /**
     * NOTE: This is used both for flags and remote config. Once the RemoteConfig is fully released this will essentially only
     * be for flags and can eventually be replaced with the new flags endpoint
     */
    _callFlagsEndpoint(options?: { disableFlags?: boolean }): void {
        // Ensure we don't have double queued /flags requests
        this._clearDebouncer()
        if (this._instance._shouldDisableFlags()) {
            // The way this is documented is essentially used to refuse to ever call the /flags endpoint.
            return
        }
        if (this._requestInFlight) {
            this._additionalReloadRequested = true
            return
        }
        const token = this._instance.config.token
        const data: Record<string, any> = {
            token: token,
            distinct_id: this._instance.get_distinct_id(),
            groups: this._instance.getGroups(),
            $anon_distinct_id: this.$anon_distinct_id,
            person_properties: {
                ...(this._instance.persistence?.get_initial_props() || {}),
                ...(this._instance.get_property(STORED_PERSON_PROPERTIES_KEY) || {}),
            },
            group_properties: this._instance.get_property(STORED_GROUP_PROPERTIES_KEY),
        }

        if (options?.disableFlags || this._instance.config.advanced_disable_feature_flags) {
            data.disable_flags = true
        }

        // Add evaluation environments if configured
        if (this._shouldIncludeEvaluationEnvironments()) {
            data.evaluation_environments = this._getValidEvaluationEnvironments()
        }

        // flags supports loading config data with the `config` query param, but if you're using remote config, you
        // don't need to add that parameter because all the config data is loaded from the remote config endpoint.
        const useRemoteConfigWithFlags = this._instance.config.__preview_remote_config

        const flagsRoute = useRemoteConfigWithFlags ? '/flags/?v=2' : '/flags/?v=2&config=true'

        const queryParams = this._instance.config.advanced_only_evaluate_survey_feature_flags
            ? '&only_evaluate_survey_feature_flags=true'
            : ''

        const url = this._instance.requestRouter.endpointFor('api', flagsRoute + queryParams)

        if (useRemoteConfigWithFlags) {
            data.timezone = getTimezone()
        }

        this._requestInFlight = true
        this._instance._send_request({
            method: 'POST',
            url,
            data,
            compression: this._instance.config.disable_compression ? undefined : Compression.Base64,
            timeout: this._instance.config.feature_flag_request_timeout_ms,
            callback: (response) => {
                let errorsLoading = true

                if (response.statusCode === 200) {
                    // successful request
                    // reset anon_distinct_id after at least a single request with it
                    // makes it through
                    if (!this._additionalReloadRequested) {
                        this.$anon_distinct_id = undefined
                    }
                    errorsLoading = false
                }

                this._requestInFlight = false

                // NB: this block is only reached if this._instance.config.__preview_remote_config is false
                if (!this._flagsCalled) {
                    this._flagsCalled = true
                    this._instance._onRemoteConfig(response.json ?? {})
                }

                if (data.disable_flags && !this._additionalReloadRequested) {
                    // If flags are disabled then there is no need to call /flags again (flags are the only thing that may change)
                    // UNLESS, an additional reload is requested.
                    return
                }

                this._flagsLoadedFromRemote = !errorsLoading

                if (response.json && response.json.quotaLimited?.includes(QuotaLimitedResource.FeatureFlags)) {
                    // log a warning and then early return
                    logger.warn(
                        'You have hit your feature flags quota limit, and will not be able to load feature flags until the quota is reset.  Please visit https://posthog.com/docs/billing/limits-alerts to learn more.'
                    )
                    return
                }

                if (!data.disable_flags) {
                    this.receivedFeatureFlags(response.json ?? {}, errorsLoading)
                }

                if (this._additionalReloadRequested) {
                    this._additionalReloadRequested = false
                    this._callFlagsEndpoint()
                }
            },
        })
    }

    /*
     * Get feature flag's value for user.
     *
     * ### Usage:
     *
     *     if(posthog.getFeatureFlag('my-flag') === 'some-variant') { // do something }
     *
     * @param {Object|String} key Key of the feature flag.
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_called event to PostHog.
     */
    getFeatureFlag(key: string, options: { send_event?: boolean } = {}): boolean | string | undefined {
        if (!this._hasLoadedFlags && !(this.getFlags() && this.getFlags().length > 0)) {
            logger.warn('getFeatureFlag for key "' + key + '" failed. Feature flags didn\'t load in time.')
            return undefined
        }
        const flagValue = this.getFlagVariants()[key]
        const flagReportValue = `${flagValue}`
        const requestId = this._instance.get_property(PERSISTENCE_FEATURE_FLAG_REQUEST_ID) || undefined
        const flagCallReported: Record<string, string[]> = this._instance.get_property(FLAG_CALL_REPORTED) || {}

        if (options.send_event || !('send_event' in options)) {
            if (!(key in flagCallReported) || !flagCallReported[key].includes(flagReportValue)) {
                if (isArray(flagCallReported[key])) {
                    flagCallReported[key].push(flagReportValue)
                } else {
                    flagCallReported[key] = [flagReportValue]
                }
                this._instance.persistence?.register({ [FLAG_CALL_REPORTED]: flagCallReported })

                const flagDetails = this.getFeatureFlagDetails(key)

                const properties: Record<string, any | undefined> = {
                    $feature_flag: key,
                    $feature_flag_response: flagValue,
                    $feature_flag_payload: this.getFeatureFlagPayload(key) || null,
                    $feature_flag_request_id: requestId,
                    $feature_flag_bootstrapped_response: this._instance.config.bootstrap?.featureFlags?.[key] || null,
                    $feature_flag_bootstrapped_payload:
                        this._instance.config.bootstrap?.featureFlagPayloads?.[key] || null,
                    // If we haven't yet received a response from the /flags endpoint, we must have used the bootstrapped value
                    $used_bootstrap_value: !this._flagsLoadedFromRemote,
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

                this._instance.capture('$feature_flag_called', properties)
            }
        }
        return flagValue
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

    getFeatureFlagPayload(key: string): JsonType {
        const payloads = this.getFlagPayloads()
        return payloads[key]
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
        const token = this._instance.config.token
        const data: Record<string, any> = {
            distinct_id: this._instance.get_distinct_id(),
            token,
        }

        // Add evaluation environments if configured
        if (this._shouldIncludeEvaluationEnvironments()) {
            data.evaluation_environments = this._getValidEvaluationEnvironments()
        }

        this._instance._send_request({
            method: 'POST',
            url: this._instance.requestRouter.endpointFor('api', '/flags/?v=2&config=true'),
            data,
            compression: this._instance.config.disable_compression ? undefined : Compression.Base64,
            timeout: this._instance.config.feature_flag_request_timeout_ms,
            callback: (response) => {
                const flagPayloads = response.json?.['featureFlagPayloads']
                callback(flagPayloads?.[key] || undefined)
            },
        })
    }

    /**
     * See if feature flag is enabled for user.
     *
     * ### Usage:
     *
     *     if(posthog.isFeatureEnabled('beta-feature')) { // do something }
     *
     * @param key Key of the feature flag.
     * @param [options] If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     * @returns A boolean value indicating whether or not the specified feature flag is enabled. If flag information has not yet been loaded,
     *          or if the specified feature flag is disabled or does not exist, returns undefined.
     */
    isFeatureEnabled(key: string, options: { send_event?: boolean } = {}): boolean | undefined {
        if (!this._hasLoadedFlags && !(this.getFlags() && this.getFlags().length > 0)) {
            logger.warn('isFeatureEnabled for key "' + key + '" failed. Feature flags didn\'t load in time.')
            return undefined
        }
        const flagValue = this.getFeatureFlag(key, options)
        return isUndefined(flagValue) ? undefined : !!flagValue
    }

    addFeatureFlagsHandler(handler: FeatureFlagsCallback): void {
        this.featureFlagEventHandlers.push(handler)
    }

    removeFeatureFlagsHandler(handler: FeatureFlagsCallback): void {
        this.featureFlagEventHandlers = this.featureFlagEventHandlers.filter((h) => h !== handler)
    }

    receivedFeatureFlags(response: Partial<FlagsResponse>, errorsLoading?: boolean): void {
        if (!this._instance.persistence) {
            return
        }
        this._hasLoadedFlags = true

        const currentFlags = this.getFlagVariants()
        const currentFlagPayloads = this.getFlagPayloads()
        const currentFlagDetails = this.getFlagsWithDetails()
        parseFlagsResponse(response, this._instance.persistence, currentFlags, currentFlagPayloads, currentFlagDetails)
        this._fireFeatureFlagsCallbacks(errorsLoading)
    }

    /**
     * @deprecated Use overrideFeatureFlags instead. This will be removed in a future version.
     */
    override(flags: boolean | string[] | Record<string, string | boolean>, suppressWarning: boolean = false): void {
        logger.warn('override is deprecated. Please use overrideFeatureFlags instead.')
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
     *     - posthog.featureFlags.overrideFeatureFlags({ // set both flags and payloads
     *         flags: {'beta-feature': 'variant'},
     *         payloads: { 'beta-feature': { someData: true } }
     *       })
     *     - posthog.featureFlags.overrideFeatureFlags({ // only override payloads
     *         payloads: { 'beta-feature': { someData: true } }
     *       })
     */
    overrideFeatureFlags(overrideOptions: OverrideFeatureFlagsOptions): void {
        if (!this._instance.__loaded || !this._instance.persistence) {
            return logger.uninitializedWarning('posthog.featureFlags.overrideFeatureFlags')
        }

        // Clear all overrides if false, lets you do something like posthog.featureFlags.overrideFeatureFlags(false)
        if (overrideOptions === false) {
            this._instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
            this._instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)
            this._fireFeatureFlagsCallbacks()
            return
        }

        if (
            overrideOptions &&
            typeof overrideOptions === 'object' &&
            ('flags' in overrideOptions || 'payloads' in overrideOptions)
        ) {
            const options = overrideOptions
            this._override_warning = Boolean(options.suppressWarning ?? false)

            // Handle flags if provided, lets you do something like posthog.featureFlags.overrideFeatureFlags({flags: ['beta-feature']})
            if ('flags' in options) {
                if (options.flags === false) {
                    this._instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
                } else if (options.flags) {
                    if (isArray(options.flags)) {
                        const flagsObj: Record<string, string | boolean> = {}
                        for (let i = 0; i < options.flags.length; i++) {
                            flagsObj[options.flags[i]] = true
                        }
                        this._instance.persistence.register({ [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: flagsObj })
                    } else {
                        this._instance.persistence.register({ [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: options.flags })
                    }
                }
            }

            // Handle payloads independently, lets you do something like posthog.featureFlags.overrideFeatureFlags({payloads: { 'beta-feature': { someData: true } }})
            if ('payloads' in options) {
                if (options.payloads === false) {
                    this._instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)
                } else if (options.payloads) {
                    this._instance.persistence.register({
                        [PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS]: options.payloads,
                    })
                }
            }

            this._fireFeatureFlagsCallbacks()
            return
        }

        this._fireFeatureFlagsCallbacks()
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
            callback(flags, flagVariants)
        }
        return () => this.removeFeatureFlagsHandler(callback)
    }

    updateEarlyAccessFeatureEnrollment(key: string, isEnrolled: boolean, stage?: string): void {
        const existing_early_access_features: EarlyAccessFeature[] =
            this._instance.get_property(PERSISTENCE_EARLY_ACCESS_FEATURES) || []
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

        this._instance.capture('$feature_enrollment_update', properties)
        this.setPersonPropertiesForFlags(enrollmentPersonProp, false)

        const newFlags = { ...this.getFlagVariants(), [key]: isEnrolled }
        this._instance.persistence?.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: Object.keys(filterActiveFeatureFlags(newFlags)),
            [ENABLED_FEATURE_FLAGS]: newFlags,
        })
        this._fireFeatureFlagsCallbacks()
    }

    getEarlyAccessFeatures(
        callback: EarlyAccessFeatureCallback,
        force_reload = false,
        stages?: EarlyAccessFeatureStage[]
    ): void {
        const existing_early_access_features = this._instance.get_property(PERSISTENCE_EARLY_ACCESS_FEATURES)

        const stageParams = stages ? `&${stages.map((s) => `stage=${s}`).join('&')}` : ''

        if (!existing_early_access_features || force_reload) {
            this._instance._send_request({
                url: this._instance.requestRouter.endpointFor(
                    'api',
                    `/api/early_access_features/?token=${this._instance.config.token}${stageParams}`
                ),
                method: 'GET',
                callback: (response) => {
                    if (!response.json) {
                        return
                    }
                    const earlyAccessFeatures = (response.json as EarlyAccessFeatureResponse).earlyAccessFeatures
                    // Unregister first to ensure complete replacement, not merge
                    // This prevents accumulation of stale features in persistence
                    this._instance.persistence?.unregister(PERSISTENCE_EARLY_ACCESS_FEATURES)
                    this._instance.persistence?.register({ [PERSISTENCE_EARLY_ACCESS_FEATURES]: earlyAccessFeatures })
                    return callback(earlyAccessFeatures)
                },
            })
        } else {
            return callback(existing_early_access_features)
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
        const { flags, flagVariants } = this._prepareFeatureFlagsForCallbacks()
        this.featureFlagEventHandlers.forEach((handler) => handler(flags, flagVariants, { errorsLoading }))
    }

    /**
     * Set override person properties for feature flags.
     * This is used when dealing with new persons / where you don't want to wait for ingestion
     * to update user properties.
     */
    setPersonPropertiesForFlags(properties: Properties, reloadFeatureFlags = true): void {
        // Get persisted person properties
        const existingProperties = this._instance.get_property(STORED_PERSON_PROPERTIES_KEY) || {}

        this._instance.register({
            [STORED_PERSON_PROPERTIES_KEY]: {
                ...existingProperties,
                ...properties,
            },
        })

        if (reloadFeatureFlags) {
            this._instance.reloadFeatureFlags()
        }
    }

    resetPersonPropertiesForFlags(): void {
        this._instance.unregister(STORED_PERSON_PROPERTIES_KEY)
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
        // Get persisted group properties
        const existingProperties = this._instance.get_property(STORED_GROUP_PROPERTIES_KEY) || {}

        if (Object.keys(existingProperties).length !== 0) {
            Object.keys(existingProperties).forEach((groupType) => {
                existingProperties[groupType] = {
                    ...existingProperties[groupType],
                    ...properties[groupType],
                }
                delete properties[groupType]
            })
        }

        this._instance.register({
            [STORED_GROUP_PROPERTIES_KEY]: {
                ...existingProperties,
                ...properties,
            },
        })

        if (reloadFeatureFlags) {
            this._instance.reloadFeatureFlags()
        }
    }

    resetGroupPropertiesForFlags(group_type?: string): void {
        if (group_type) {
            const existingProperties = this._instance.get_property(STORED_GROUP_PROPERTIES_KEY) || {}
            this._instance.register({
                [STORED_GROUP_PROPERTIES_KEY]: { ...existingProperties, [group_type]: {} },
            })
        } else {
            this._instance.unregister(STORED_GROUP_PROPERTIES_KEY)
        }
    }

    reset(): void {
        this._hasLoadedFlags = false
        this._requestInFlight = false
        this._reloadingDisabled = false
        this._additionalReloadRequested = false
        this._flagsCalled = false
        this._flagsLoadedFromRemote = false
        this.$anon_distinct_id = undefined
        this._clearDebouncer()
        this._override_warning = false
    }
}
