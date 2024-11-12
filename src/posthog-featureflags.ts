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
    ClientAssignedFeatureFlag,
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
import { logger } from './utils/logger'

const PERSISTENCE_ACTIVE_FEATURE_FLAGS = '$active_feature_flags'
const PERSISTENCE_OVERRIDE_FEATURE_FLAGS = '$override_feature_flags'
const PERSISTENCE_FEATURE_FLAG_PAYLOADS = '$feature_flag_payloads'

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

export class PostHogFeatureFlags {
    instance: PostHog
    _override_warning: boolean
    featureFlagEventHandlers: FeatureFlagsCallback[]
    reloadFeatureFlagsQueued: boolean
    reloadFeatureFlagsInAction: boolean
    $anon_distinct_id: string | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this._override_warning = false
        this.featureFlagEventHandlers = []

        this.reloadFeatureFlagsQueued = false
        this.reloadFeatureFlagsInAction = false
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
        return flagPayloads || {}
    }

    /**
     * Reloads feature flags asynchronously.
     *
     * Constraints:
     *
     * 1. Avoid parallel requests
     * 2. Delay a few milliseconds after each reloadFeatureFlags call to batch subsequent changes together
     * 3. Don't call this during initial load (as /decide will be called instead), see posthog-core.js
     */
    reloadFeatureFlags(): void {
        if (!this.reloadFeatureFlagsQueued) {
            this.reloadFeatureFlagsQueued = true
            this._startReloadTimer()
        }
    }

    setAnonymousDistinctId(anon_distinct_id: string): void {
        this.$anon_distinct_id = anon_distinct_id
    }

    setReloadingPaused(isPaused: boolean): void {
        this.reloadFeatureFlagsInAction = isPaused
    }

    resetRequestQueue(): void {
        this.reloadFeatureFlagsQueued = false
    }

    _startReloadTimer(): void {
        if (this.reloadFeatureFlagsQueued && !this.reloadFeatureFlagsInAction) {
            setTimeout(() => {
                if (!this.reloadFeatureFlagsInAction && this.reloadFeatureFlagsQueued) {
                    this.reloadFeatureFlagsQueued = false
                    this._reloadFeatureFlagsRequest()
                }
            }, 5)
        }
    }

    _reloadFeatureFlagsRequest(): void {
        if (this.instance.config.advanced_disable_feature_flags) {
            return
        }

        this.setReloadingPaused(true)
        const token = this.instance.config.token
        const personProperties = this.instance.get_property(STORED_PERSON_PROPERTIES_KEY)
        const groupProperties = this.instance.get_property(STORED_GROUP_PROPERTIES_KEY)
        const json_data = {
            token: token,
            distinct_id: this.instance.get_distinct_id(),
            groups: this.instance.getGroups(),
            $anon_distinct_id: this.$anon_distinct_id,
            person_properties: personProperties,
            group_properties: groupProperties,
            disable_flags: this.instance.config.advanced_disable_feature_flags || undefined,
        }

        this.instance._send_request({
            method: 'POST',
            url: this.instance.requestRouter.endpointFor('api', '/decide/?v=3'),
            data: json_data,
            compression: this.instance.config.disable_compression ? undefined : Compression.Base64,
            timeout: this.instance.config.feature_flag_request_timeout_ms,
            callback: (response) => {
                this.setReloadingPaused(false)

                let errorsLoading = true

                if (response.statusCode === 200) {
                    // successful request
                    // reset anon_distinct_id after at least a single request with it
                    // makes it through
                    this.$anon_distinct_id = undefined
                    errorsLoading = false
                }
                // :TRICKY: We want to fire the callback even if the request fails
                // and return existing flags if they exist
                // This is because we don't want to block clients waiting for flags to load.
                // It's possible they're waiting for the callback to render the UI, but it never occurs.
                this.receivedFeatureFlags(response.json ?? {}, errorsLoading)

                // :TRICKY: Reload - start another request if queued!
                this._startReloadTimer()
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
        if (!this.instance.decideEndpointWasHit && !(this.getFlags() && this.getFlags().length > 0)) {
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

                this.instance.capture('$feature_flag_called', { $feature_flag: key, $feature_flag_response: flagValue })
            }
        }
        return flagValue
    }

    getFeatureFlagPayload(key: string): JsonType {
        const payloads = this.getFlagPayloads()
        return payloads[key]
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
        if (!this.instance.decideEndpointWasHit && !(this.getFlags() && this.getFlags().length > 0)) {
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
        this.instance.decideEndpointWasHit = true
        const currentFlags = this.getFlagVariants()
        const currentFlagPayloads = this.getFlagPayloads()
        parseFeatureFlagDecideResponse(response, this.instance.persistence, currentFlags, currentFlagPayloads)
        this._fireFeatureFlagsCallbacks(errorsLoading)
    }

    /*
     * Override feature flags on the client-side.  Useful for setting non-persistent feature flags, or for testing/debugging
     * feature flags in the PostHog app.
     *
     * ### Usage:
     *
     *     - posthog.feature_flags.override(false)
     *     - posthog.feature_flags.override(['beta-feature'])
     *     - posthog.feature_flags.override({'beta-feature': 'variant', 'other-feature': true})
     *     - posthog.feature_flags.override({'beta-feature': 'variant'}, true) // Suppress warning log
     *
     * @param {Object|Array|String} flags Flags to override with.
     * @param {boolean} [suppressWarning=false] Optional parameter to suppress the override warning.
     */
    override(flags: boolean | string[] | Record<string, string | boolean>, suppressWarning: boolean = false): void {
        if (!this.instance.__loaded || !this.instance.persistence) {
            return logger.uninitializedWarning('posthog.feature_flags.override')
        }

        this._override_warning = suppressWarning

        if (flags === false) {
            this.instance.persistence.unregister(PERSISTENCE_OVERRIDE_FEATURE_FLAGS)
        } else if (isArray(flags)) {
            const flagsObj: Record<string, string | boolean> = {}
            for (let i = 0; i < flags.length; i++) {
                flagsObj[flags[i]] = true
            }
            this.instance.persistence.register({ [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: flagsObj })
        } else {
            this.instance.persistence.register({ [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: flags })
        }
    }
    /*
     * Register an event listener that runs when feature flags become available or when they change.
     * If there are flags, the listener is called immediately in addition to being called on future changes.
     *
     * ### Usage:
     *
     *     posthog.onFeatureFlags(function(featureFlags) { // do something })
     *
     * @param {Function} [callback] The callback function will be called once the feature flags are ready or when they are updated.
     *                              It'll return a list of feature flags enabled for the user.
     * @returns {Function} A function that can be called to unsubscribe the listener. Used by useEffect when the component unmounts.
     */
    onFeatureFlags(callback: FeatureFlagsCallback): () => void {
        this.addFeatureFlagsHandler(callback)
        if (this.instance.decideEndpointWasHit) {
            const { flags, flagVariants } = this._prepareFeatureFlagsForCallbacks()
            callback(flags, flagVariants)
        }
        return () => this.removeFeatureFlagsHandler(callback)
    }

    updateEarlyAccessFeatureEnrollment(key: string, isEnrolled: boolean): void {
        const enrollmentPersonProp = {
            [`$feature_enrollment/${key}`]: isEnrolled,
        }
        this.instance.capture('$feature_enrollment_update', {
            $feature_flag: key,
            $feature_enrollment: isEnrolled,
            $set: enrollmentPersonProp,
        })
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
                transport: 'XHR',
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

    _getMatchingVariant(featureFlag: ClientAssignedFeatureFlag): string | null {
        const lookupTable = this._variantLookupTable(featureFlag.variants)
        const hash = this._get_hash(featureFlag.key, this.instance.get_distinct_id(), 'variant')

        for (const variant of lookupTable) {
            if (hash >= variant.value_min && hash < variant.value_max) {
                return variant.key
            }
        }
        return null
    }

    // TODO how should this behave for erroneous values?
    _variantLookupTable(variants: Record<string, number>): { value_min: number; value_max: number; key: string }[] {
        const lookupTable: { value_min: number; value_max: number; key: string }[] = []
        let valueMin = 0

        for (const [variant, percentage] of Object.entries(variants)) {
            const valueMax = valueMin + percentage
            lookupTable.push({
                value_min: valueMin,
                value_max: valueMax,
                key: variant,
            })
            valueMin = valueMax
        }
        return lookupTable
    }

    _get_hash(featureFlagKey: string, distinctId: string, salt: string = ''): number {
        const hashKey = `${featureFlagKey}.${distinctId}${salt}`
        const hashHex = this._hash(hashKey)
        // TODO do we care about IE11 support for BigInt?
        const hashInt = BigInt(`0x${hashHex}`)
        const LONG_SCALE = BigInt('0xFFFFFFFFFFFFFFF')
        return Number(hashInt) / Number(LONG_SCALE) // Normalize the hash to a value between 0 and 1
    }

    // TODO how much do we trust sonnet to write a hashing function?
    _hash(input: string): string {
        function rotateLeft(n: number, s: number): number {
            return ((n << s) | (n >>> (32 - s))) >>> 0
        }

        let H0 = 0x67452301
        let H1 = 0xefcdab89
        let H2 = 0x98badcfe
        let H3 = 0x10325476
        let H4 = 0xc3d2e1f0

        // Convert string to byte array
        const bytes: number[] = []
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i)
            bytes.push(char & 0xff)
        }

        // Add padding
        bytes.push(0x80)
        while ((bytes.length * 8) % 512 !== 448) {
            bytes.push(0)
        }

        const bitLen = input.length * 8
        bytes.push(0, 0, 0, 0) // JavaScript bitwise ops are 32-bit
        bytes.push((bitLen >>> 24) & 0xff)
        bytes.push((bitLen >>> 16) & 0xff)
        bytes.push((bitLen >>> 8) & 0xff)
        bytes.push(bitLen & 0xff)

        // Process blocks
        for (let i = 0; i < bytes.length; i += 64) {
            const w = new Array(80)
            for (let j = 0; j < 16; j++) {
                w[j] =
                    (bytes[i + j * 4] << 24) |
                    (bytes[i + j * 4 + 1] << 16) |
                    (bytes[i + j * 4 + 2] << 8) |
                    bytes[i + j * 4 + 3]
            }

            for (let j = 16; j < 80; j++) {
                w[j] = rotateLeft(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1)
            }

            let [a, b, c, d, e] = [H0, H1, H2, H3, H4]

            for (let j = 0; j < 80; j++) {
                const f =
                    j < 20 ? (b & c) | (~b & d) : j < 40 ? b ^ c ^ d : j < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d

                const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6

                const temp = (rotateLeft(a, 5) + f + e + k + w[j]) >>> 0
                e = d
                d = c
                c = rotateLeft(b, 30)
                b = a
                a = temp
            }

            H0 = (H0 + a) >>> 0
            H1 = (H1 + b) >>> 0
            H2 = (H2 + c) >>> 0
            H3 = (H3 + d) >>> 0
            H4 = (H4 + e) >>> 0
        }

        return [H0, H1, H2, H3, H4]
            .map((n) => n.toString(16).padStart(8, '0'))
            .join('')
            .slice(0, 15)
    }
}
