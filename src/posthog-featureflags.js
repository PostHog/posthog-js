import { _ } from './utils'

export const parseFeatureFlagDecideResponse = (response, persistence) => {
    const flags = response['featureFlags']
    if (flags) {
        const uses_v1_api = Array.isArray(flags)
        const $active_feature_flags = uses_v1_api ? flags : Object.keys(flags)
        const $enabled_feature_flags = uses_v1_api ? {} : flags
        if (uses_v1_api && $active_feature_flags) {
            for (let i = 0; i < $active_feature_flags.length; i++) {
                $enabled_feature_flags[$active_feature_flags[i]] = true
            }
        }

        persistence &&
            persistence.register({
                $active_feature_flags,
                $enabled_feature_flags,
            })
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

        if (!this._override_warning) {
            console.warn(
                '[PostHog] Overriding feature flags! Feature flags from server were: ' + JSON.stringify(enabledFlags)
            )
        }
        this._override_warning = true

        const flags = {}
        if (Array.isArray(overriddenFlags)) {
            // /decide?v=1 array (replace all)
            for (let i = 0; i < overriddenFlags.length; i++) {
                flags[overriddenFlags[i]] = true
            }
        } else {
            // /decide?v=2 object (merge objects... with IE11 compatibility)
            const existingKeys = Object.keys(enabledFlags)
            for (let i = 0; i < existingKeys.length; i++) {
                flags[existingKeys[i]] = enabledFlags[existingKeys[i]]
            }

            const overriddenKeys = Object.keys(overriddenFlags)
            for (let i = 0; i < overriddenKeys.length; i++) {
                if (overriddenFlags[overriddenKeys[i]] === false) {
                    delete flags[overriddenKeys[i]]
                } else {
                    flags[overriddenKeys[i]] = overriddenFlags[overriddenKeys[i]]
                }
            }
        }
        return flags
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
            this.instance._prepare_callback(parseFeatureFlagDecideResponse)
        )
    }

    /*
     * Get feature flag's value for user.
     *
     * ### Usage:
     *
     *     if(posthog.getFeatureFlag('my-flag') === 'some-variant') { // do something }
     *
     * @param {Object|String} prop Key of the feature flag.
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
     * @param {Object|String} prop Key of the feature flag.
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     */
    isFeatureEnabled(key, options = {}) {
        if (!this.getFlags()) {
            console.warn('isFeatureEnabled for key "' + key + '" failed. Feature flags didn\'t load in time.')
            return false
        }
        return !!this.getFeatureFlag(key, options)
    }

    /*
     * Override feature flags for debugging.
     *
     * ### Usage:
     *
     *     posthog.feature_flags.override(['beta-feature']) or posthog.feature_flags.override(false)
     *
     * @param {Object|String} prop Flags to override with.
     */
    override(flags) {
        if (flags === false) return this.instance.persistence.unregister('$override_feature_flags')
        this.instance.persistence.register('$override_feature_flags', flags)
    }
}
