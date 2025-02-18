import { entries, extend } from './utils'
import { PostHog } from './posthog-core'
import {
    DecideResponse,
    FeatureFlagsCallback,
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureResponse,
    Properties,
    JsonType,
    Compression,
    EarlyAccessFeature,
    RemoteConfigFeatureFlagCallback,
} from './types'
import { PostHogPersistence } from './posthog-persistence'

import {
    PERSISTENCE_EARLY_ACCESS_FEATURES,
    ENABLED_FEATURE_FLAGS,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
    FLAG_CALL_REPORTED,
} from './constants'

import { isArray } from './utils/type-utils'
import { createLogger } from './utils/logger'

const logger = createLogger('[FeatureFlags]')

const PERSISTENCE_ACTIVE_FEATURE_FLAGS = '$active_feature_flags'
const PERSISTENCE_OVERRIDE_FEATURE_FLAGS = '$override_feature_flags'
const PERSISTENCE_FEATURE_FLAG_PAYLOADS = '$feature_flag_payloads'
const PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS = '$override_feature_flag_payloads'

export const filterActiveFeatureFlags = (featureFlags?: Record<string, string | boolean>) => {
    const activeFeatureFlags: Record<string, string | boolean> = {}
    for (const [key, value] of entries(featureFlags || {})) {
        if (value) {
            activeFeatureFlags[key] = value
        }
    }
    return activeFeatureFlags
}

export const parseFeatureFlagDecideResponse = (
    response: Partial<DecideResponse>,
    persistence: PostHogPersistence,
    currentFlags: Record<string, string | boolean> = {},
    currentFlagPayloads: Record<string, JsonType> = {}
) => {
    const flags = response['featureFlags']
    const flagPayloads = response['featureFlagPayloads']
    if (!flags) {
        return
    }
    // using the v1 api
    if (isArray(flags)) {
        const $enabled_feature_flags: Record<string, boolean> = {}
        if (flags) {
            for (let i = 0; i < flags.length; i++) {
                $enabled_feature_flags[flags[i]] = true
            }
        }
        persistence &&
            persistence.register({
                [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: flags,
                [ENABLED_FEATURE_FLAGS]: $enabled_feature_flags,
            })
        return
    }

    // using the v2+ api
    let newFeatureFlags = flags
    let newFeatureFlagPayloads = flagPayloads
    if (response.errorsWhileComputingFlags) {
        // if not all flags were computed, we upsert flags instead of replacing them
        newFeatureFlags = { ...currentFlags, ...newFeatureFlags }
        newFeatureFlagPayloads = { ...currentFlagPayloads, ...newFeatureFlagPayloads }
    }
    persistence &&
        persistence.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: Object.keys(filterActiveFeatureFlags(newFeatureFlags)),
            [ENABLED_FEATURE_FLAGS]: newFeatureFlags || {},
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: newFeatureFlagPayloads || {},
        })
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

export class PostHogFeatureFlags {
    _override_warning: boolean = false
    featureFlagEventHandlers: FeatureFlagsCallback[]
    $anon_distinct_id: string | undefined
    private _hasLoadedFlags: boolean = false
    private _requestInFlight: boolean = false
    private _reloadingDisabled: boolean = false
    private _additionalReloadRequested: boolean = false
    private _reloadDebouncer?: any
    private _decideCalled: boolean = false
    private _flagsLoadedFromRemote: boolean = false

    constructor(private instance: PostHog) {
        this.featureFlagEventHandlers = []
    }

    decide(): void {
        if (this.instance.config.__preview_remote_config) {
            // If remote config is enabled we don't call decide and we mark it as called so that we don't simulate it
            this._decideCalled = true
            return
        }

        // TRICKY: We want to disable flags if we don't have a queued reload, and one of the settings exist for disabling on first load
        const disableFlags =
            !this._reloadDebouncer &&
            (this.instance.config.advanced_disable_feature_flags ||
                this.instance.config.advanced_disable_feature_flags_on_first_load)

        this._callDecideEndpoint({
            disableFlags,
        })
    }

    get hasLoadedFlags(): boolean {
        return this._hasLoadedFlags
    }

    getFlags(): string[] {
        return Object.keys(this.getFlagVariants())
    }

    getFlagVariants(): Record<string, string | boolean> {
        const enabledFlags = this.instance.get_property(ENABLED_FEATURE_FLAGS)
        const overriddenFlags = this.instance.get_property(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
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
        const flagPayloads = this.instance.get_property(PERSISTENCE_FEATURE_FLAG_PAYLOADS)
        const overriddenPayloads = this.instance.get_property(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)

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
        if (this._reloadingDisabled || this.instance.config.advanced_disable_feature_flags) {
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
            this._callDecideEndpoint()
        }, 5)
    }

    private clearDebouncer(): void {
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
    _callDecideEndpoint(options?: { disableFlags?: boolean }): void {
        // Ensure we don't have double queued decide requests
        this.clearDebouncer()
        if (this.instance.config.advanced_disable_decide) {
            // The way this is documented is essentially used to refuse to ever call the decide endpoint.
            return
        }
        if (this._requestInFlight) {
            this._additionalReloadRequested = true
            return
        }
        const token = this.instance.config.token
        const data: Record<string, any> = {
            token: token,
            distinct_id: this.instance.get_distinct_id(),
            groups: this.instance.getGroups(),
            $anon_distinct_id: this.$anon_distinct_id,
            person_properties: this.instance.get_property(STORED_PERSON_PROPERTIES_KEY),
            group_properties: this.instance.get_property(STORED_GROUP_PROPERTIES_KEY),
        }

        if (options?.disableFlags || this.instance.config.advanced_disable_feature_flags) {
            data.disable_flags = true
        }

        this._requestInFlight = true
        this.instance._send_request({
            method: 'POST',
            url: this.instance.requestRouter.endpointFor('api', '/decide/?v=3'),
            data,
            compression: this.instance.config.disable_compression ? undefined : Compression.Base64,
            timeout: this.instance.config.feature_flag_request_timeout_ms,
            callback: (response) => {
                let errorsLoading = true

                if (response.statusCode === 200) {
                    // successful request
                    // reset anon_distinct_id after at least a single request with it
                    // makes it through
                    this.$anon_distinct_id = undefined
                    errorsLoading = false
                }

                this._requestInFlight = false

                if (!this._decideCalled) {
                    this._decideCalled = true
                    this.instance._onRemoteConfig(response.json ?? {})
                }

                if (data.disable_flags) {
                    // If flags are disabled then there is no need to call decide again (flags are the only thing that may change)
                    return
                }

                this._flagsLoadedFromRemote = !errorsLoading
                this.receivedFeatureFlags(response.json ?? {}, errorsLoading)

                if (this._additionalReloadRequested) {
                    this._additionalReloadRequested = false
                    this._callDecideEndpoint()
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
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     */
    getFeatureFlag(key: string, options: { send_event?: boolean } = {}): boolean | string | undefined {
        if (!this._hasLoadedFlags && !(this.getFlags() && this.getFlags().length > 0)) {
            logger.warn('getFeatureFlag for key "' + key + '" failed. Feature flags didn\'t load in time.')
            return undefined
        }
        const flagValue = this.getFlagVariants()[key]
        const flagReportValue = `${flagValue}`
        const flagCallReported: Record<string, string[]> = this.instance.get_property(FLAG_CALL_REPORTED) || {}

        if (options.send_event || !('send_event' in options)) {
            if (!(key in flagCallReported) || !flagCallReported[key].includes(flagReportValue)) {
                if (isArray(flagCallReported[key])) {
                    flagCallReported[key].push(flagReportValue)
                } else {
                    flagCallReported[key] = [flagReportValue]
                }
                this.instance.persistence?.register({ [FLAG_CALL_REPORTED]: flagCallReported })

                this.instance.capture('$feature_flag_called', {
                    $feature_flag: key,
                    $feature_flag_response: flagValue,
                    $feature_flag_payload: this.getFeatureFlagPayload(key) || null,
                    $feature_flag_bootstrapped_response: this.instance.config.bootstrap?.featureFlags?.[key] || null,
                    $feature_flag_bootstrapped_payload:
                        this.instance.config.bootstrap?.featureFlagPayloads?.[key] || null,
                    // If we haven't yet received a response from the /decide endpoint, we must have used the bootstrapped value
                    $used_bootstrap_value: !this._flagsLoadedFromRemote,
                })
            }
        }
        return flagValue
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
        const token = this.instance.config.token
        this.instance._send_request({
            method: 'POST',
            url: this.instance.requestRouter.endpointFor('api', '/decide/?v=3'),
            data: {
                distinct_id: this.instance.get_distinct_id(),
                token,
            },
            compression: this.instance.config.disable_compression ? undefined : Compression.Base64,
            timeout: this.instance.config.feature_flag_request_timeout_ms,
            callback: (response) => {
                const flagPayloads = response.json?.['featureFlagPayloads']
                callback(flagPayloads?.[key] || undefined)
            },
        })
    }

    /*
     * See if feature flag is enabled for user.
     *
     * ### Usage:
     *
     *     if(posthog.isFeatureEnabled('beta-feature')) { // do something }
     *
     * @param {Object|String} key Key of the feature flag.
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     */
    isFeatureEnabled(key: string, options: { send_event?: boolean } = {}): boolean | undefined {
        if (!this._hasLoadedFlags && !(this.getFlags() && this.getFlags().length > 0)) {
            logger.warn('isFeatureEnabled for key "' + key + '" failed. Feature flags didn\'t load in time.')
            return undefined
        }
        return !!this.getFeatureFlag(key, options)
    }

    addFeatureFlagsHandler(handler: FeatureFlagsCallback): void {
        this.featureFlagEventHandlers.push(handler)
    }

    removeFeatureFlagsHandler(handler: FeatureFlagsCallback): void {
        this.featureFlagEventHandlers = this.featureFlagEventHandlers.filter((h) => h !== handler)
    }

    receivedFeatureFlags(response: Partial<DecideResponse>, errorsLoading?: boolean): void {
        if (!this.instance.persistence) {
            return
        }
        this._hasLoadedFlags = true

        const currentFlags = this.getFlagVariants()
        const currentFlagPayloads = this.getFlagPayloads()
        parseFeatureFlagDecideResponse(response, this.instance.persistence, currentFlags, currentFlagPayloads)
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
     *     - posthog.feature_flags.overrideFeatureFlags(false) // clear all overrides
     *     - posthog.feature_flags.overrideFeatureFlags(['beta-feature']) // enable flags
     *     - posthog.feature_flags.overrideFeatureFlags({'beta-feature': 'variant'}) // set variants
     *     - posthog.feature_flags.overrideFeatureFlags({ // set both flags and payloads
     *         flags: {'beta-feature': 'variant'},
     *         payloads: { 'beta-feature': { someData: true } }
     *       })
     *     - posthog.feature_flags.overrideFeatureFlags({ // only override payloads
     *         payloads: { 'beta-feature': { someData: true } }
     *       })
     */
    overrideFeatureFlags(overrideOptions: OverrideFeatureFlagsOptions): void {
        if (!this.instance.__loaded || !this.instance.persistence) {
            return logger.uninitializedWarning('posthog.feature_flags.overrideFeatureFlags')
        }

        // Clear all overrides if false, lets you do something like posthog.feature_flags.overrideFeatureFlags(false)
        if (overrideOptions === false) {
            this.instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
            this.instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)
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

            // Handle flags if provided, lets you do something like posthog.feature_flags.overrideFeatureFlags({flags: ['beta-feature']})
            if ('flags' in options) {
                if (options.flags === false) {
                    this.instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
                } else if (options.flags) {
                    if (isArray(options.flags)) {
                        const flagsObj: Record<string, string | boolean> = {}
                        for (let i = 0; i < options.flags.length; i++) {
                            flagsObj[options.flags[i]] = true
                        }
                        this.instance.persistence.register({ [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: flagsObj })
                    } else {
                        this.instance.persistence.register({ [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: options.flags })
                    }
                }
            }

            // Handle payloads independently, lets you do something like posthog.feature_flags.overrideFeatureFlags({payloads: { 'beta-feature': { someData: true } }})
            if ('payloads' in options) {
                if (options.payloads === false) {
                    this.instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS)
                } else if (options.payloads) {
                    this.instance.persistence.register({
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

    updateEarlyAccessFeatureEnrollment(key: string, isEnrolled: boolean): void {
        const existing_early_access_features: EarlyAccessFeature[] =
            this.instance.get_property(PERSISTENCE_EARLY_ACCESS_FEATURES) || []
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

        this.instance.capture('$feature_enrollment_update', properties)
        this.setPersonPropertiesForFlags(enrollmentPersonProp, false)

        const newFlags = { ...this.getFlagVariants(), [key]: isEnrolled }
        this.instance.persistence?.register({
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: Object.keys(filterActiveFeatureFlags(newFlags)),
            [ENABLED_FEATURE_FLAGS]: newFlags,
        })
        this._fireFeatureFlagsCallbacks()
    }

    getEarlyAccessFeatures(callback: EarlyAccessFeatureCallback, force_reload = false): void {
        const existing_early_access_features = this.instance.get_property(PERSISTENCE_EARLY_ACCESS_FEATURES)

        if (!existing_early_access_features || force_reload) {
            this.instance._send_request({
                url: this.instance.requestRouter.endpointFor(
                    'api',
                    `/api/early_access_features/?token=${this.instance.config.token}`
                ),
                method: 'GET',
                callback: (response) => {
                    if (!response.json) {
                        return
                    }
                    const earlyAccessFeatures = (response.json as EarlyAccessFeatureResponse).earlyAccessFeatures
                    this.instance.persistence?.register({ [PERSISTENCE_EARLY_ACCESS_FEATURES]: earlyAccessFeatures })
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
        const existingProperties = this.instance.get_property(STORED_PERSON_PROPERTIES_KEY) || {}

        this.instance.register({
            [STORED_PERSON_PROPERTIES_KEY]: {
                ...existingProperties,
                ...properties,
            },
        })

        if (reloadFeatureFlags) {
            this.instance.reloadFeatureFlags()
        }
    }

    resetPersonPropertiesForFlags(): void {
        this.instance.unregister(STORED_PERSON_PROPERTIES_KEY)
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
        const existingProperties = this.instance.get_property(STORED_GROUP_PROPERTIES_KEY) || {}

        if (Object.keys(existingProperties).length !== 0) {
            Object.keys(existingProperties).forEach((groupType) => {
                existingProperties[groupType] = {
                    ...existingProperties[groupType],
                    ...properties[groupType],
                }
                delete properties[groupType]
            })
        }

        this.instance.register({
            [STORED_GROUP_PROPERTIES_KEY]: {
                ...existingProperties,
                ...properties,
            },
        })

        if (reloadFeatureFlags) {
            this.instance.reloadFeatureFlags()
        }
    }

    resetGroupPropertiesForFlags(group_type?: string): void {
        if (group_type) {
            const existingProperties = this.instance.get_property(STORED_GROUP_PROPERTIES_KEY) || {}
            this.instance.register({
                [STORED_GROUP_PROPERTIES_KEY]: { ...existingProperties, [group_type]: {} },
            })
        } else {
            this.instance.unregister(STORED_GROUP_PROPERTIES_KEY)
        }
    }
}
