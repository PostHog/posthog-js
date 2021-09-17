import { _ } from './utils'

export const parseFeatureFlagDecideResponse = (response, persistence) => {
    const flags = response['featureFlags']
    if (flags) {
        // using the v1 api
        if (Array.isArray(flags)) {
            const $enabled_feature_flags = {}
            if (flags) {
                for (let i = 0; i < flags.length; i++) {
                    $enabled_feature_flags[flags[i]] = true
                }
            }
            persistence &&
                persistence.register({
                    $active_feature_flags: flags,
                    $enabled_feature_flags,
                })
        } else {
            // using the v2 api
            persistence &&
                persistence.register({
                    $active_feature_flags: Object.keys(flags || {}),
                    $enabled_feature_flags: flags || {},
                })
        }
    } else {
        if (persistence) {
            persistence.unregister('$active_feature_flags')
            persistence.unregister('$enabled_feature_flags')
        }
    }
}

export class PostHogFeatureFlags {
    constructor(instance) {
        this.instance = instance
        this._override_warning = false
        this.flagCallReported = {}
        this.featureFlagEventHandlers = []
    }

    getFlags() {
        return Object.keys(this.getFlagVariants())
    }

    getFlagVariants() {
        const enabledFlags = this.instance.get_property('$enabled_feature_flags')
        const overriddenFlags = this.instance.get_property('$override_feature_flags')
        if (!overriddenFlags) {
            return enabledFlags || {}
        }

        const finalFlags = _.extend({}, enabledFlags)
        const overriddenKeys = Object.keys(overriddenFlags)
        for (let i = 0; i < overriddenKeys.length; i++) {
            if (overriddenFlags[overriddenKeys[i]] === false) {
                delete finalFlags[overriddenKeys[i]]
            } else {
                finalFlags[overriddenKeys[i]] = overriddenFlags[overriddenKeys[i]]
            }
        }
        if (!this._override_warning) {
            console.warn('[PostHog] Overriding feature flags!', {
                enabledFlags,
                overriddenFlags,
                finalFlags,
            })
            this._override_warning = true
        }
        return finalFlags
    }

    reloadFeatureFlags() {
        const token = this.instance.get_config('token')
        const json_data = JSON.stringify({
            token: token,
            distinct_id: this.instance.get_distinct_id(),
        })
        const encoded_data = _.base64Encode(json_data)
        this.instance._send_request(
            this.instance.get_config('api_host') + '/decide/?v=2',
            { data: encoded_data },
            { method: 'POST' },
            this.instance._prepare_callback((response) => {
                parseFeatureFlagDecideResponse(response, this.instance.persistence)
                this.receivedFeatureFlags()
            })
        )
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
    getFeatureFlag(key, options = {}) {
        if (!this.getFlags()) {
            console.warn('getFeatureFlag for key "' + key + '" failed. Feature flags didn\'t load in time.')
            return false
        }
        const flagValue = this.getFlagVariants()[key]
        if ((options.send_event || !('send_event' in options)) && !this.flagCallReported[key]) {
            this.flagCallReported[key] = true
            this.instance.capture('$feature_flag_called', { $feature_flag: key, $feature_flag_response: flagValue })
        }
        return flagValue
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
    isFeatureEnabled(key, options = {}) {
        if (!this.getFlags()) {
            console.warn('isFeatureEnabled for key "' + key + '" failed. Feature flags didn\'t load in time.')
            return false
        }
        return !!this.getFeatureFlag(key, options)
    }

    addFeatureFlagsHandler(handler) {
        this.featureFlagEventHandlers.push(handler)
    }

    receivedFeatureFlags() {
        const flags = this.getFlags()
        const variants = this.getFlagVariants()
        this.featureFlagEventHandlers.forEach((handler) => handler(flags, variants))
    }

    /*
     * Override feature flags for debugging.
     *
     * ### Usage:
     *
     *     - posthog.feature_flags.override(false)
     *     - posthog.feature_flags.override(['beta-feature'])
     *     - posthog.feature_flags.override({'beta-feature': 'variant', 'other-feature': True})
     *
     * @param {Object|Array|String} flags Flags to override with.
     */
    override(flags) {
        this._override_warning = false

        if (flags === false) {
            this.instance.persistence.unregister('$override_feature_flags')
        } else if (Array.isArray(flags)) {
            const flagsObj = {}
            for (let i = 0; i < flags.length; i++) {
                flagsObj[flags[i]] = true
            }
            this.instance.persistence.register({ '$override_feature_flags': flagsObj })
        } else {
            this.instance.persistence.register({ '$override_feature_flags': flags })
        }
    }
}
