import { _ } from './utils'

export class PostHogFeatureFlags {
    constructor(instance) {
        this.instance = instance
        this._override_warning = false
    }

    getFlags() {
        if (this.instance.get_property('$override_feature_flags')) {
            if (!this._override_warning)
                console.warn(
                    '[PostHog] Overriding feature flags! Feature flags from server were: ' +
                        JSON.stringify(this.instance.get_property('$active_feature_flags'))
                )
            this._override_warning = true
            return this.instance.get_property('$override_feature_flags')
        }
        return this.instance.get_property('$active_feature_flags')
    }

    reloadFeatureFlags() {
        const parseDecideResponse = _.bind(function (response) {
            if (response['featureFlags']) {
                this.instance.persistence &&
                    this.instance.persistence.register({ $active_feature_flags: response['featureFlags'] })
            } else {
                this.instance.persistence && this.instance.persistence.unregister('$active_feature_flags')
            }
        }, this)

        const token = this.instance.get_config('token')
        const json_data = _.JSONEncode({
            token: token,
            distinct_id: this.instance.get_distinct_id(),
        })
        const encoded_data = _.base64Encode(json_data)
        this.instance._send_request(
            this.instance.get_config('api_host') + '/decide/',
            { data: encoded_data },
            { method: 'POST' },
            this.instance._prepare_callback(parseDecideResponse)
        )
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
        const flagEnabled = this.getFlags().indexOf(key) > -1
        if (options.send_event || !('send_event' in options)) {
            this.instance.capture('$feature_flag_called', { $feature_flag: key, $feature_flag_response: response })
        }
        return flagEnabled
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
