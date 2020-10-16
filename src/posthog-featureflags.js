import { _ } from './utils'
/**
 * PostHog People Object
 * @constructor
 */
var PostHogFeatureFlags = function () {}

PostHogFeatureFlags.prototype._init = function (posthog_instance) {
    this._posthog = posthog_instance
}

PostHogFeatureFlags.prototype.getFlags = function () {
    if (this._posthog.get_property('$override_feature_flags')) {
        if (!this._override_warning)
            console.warn(
                '[PostHog] Overriding feature flags! Feature flags from server were: ' +
                    JSON.stringify(this._posthog.get_property('$active_feature_flags'))
            )
        this._override_warning = true
        return this._posthog.get_property('$override_feature_flags')
    }
    return this._posthog.get_property('$active_feature_flags')
}

PostHogFeatureFlags.prototype.reloadFeatureFlags = function () {
    var posthog = this._posthog
    var parseDecideResponse = _.bind(function (response) {
        if (response['featureFlags']) {
            posthog.persistence && posthog.persistence.register({ $active_feature_flags: response['featureFlags'] })
        } else {
            posthog.persistence && posthog.persistence.unregister('$active_feature_flags')
        }
    })

    var token = posthog.config.token
    var json_data = _.JSONEncode({
        token: token,
        distinct_id: posthog.get_distinct_id(),
    })
    var encoded_data = _.base64Encode(json_data)
    posthog._send_request(
        posthog.get_config('api_host') + '/decide/',
        { data: encoded_data },
        { method: 'POST' },
        posthog._prepare_callback(parseDecideResponse)
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
 */
PostHogFeatureFlags.prototype.isFeatureEnabled = function (key) {
    if (!this.getFlags()) {
        console.warn('isFeatureEnabled for key "' + key + '" failed. Feature flags didn\'t load in time.')
        return false
    }
    let response = this.getFlags().indexOf(key) > -1
    this._posthog.capture('$feature_flag_called', { $feature_flag: key, $feature_flag_response: response })
    return response
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
PostHogFeatureFlags.prototype.override = function (flags) {
    if (flags === false) return this._posthog.persistence.unregister('$override_feature_flags')
    this._posthog.persistence.register('$override_feature_flags', flags)
}

export { PostHogFeatureFlags }
