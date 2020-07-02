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
    if (this._posthog.persistence.props['$override_feature_flags']) {
        if (!this._override_warning)
            console.warn(
                '[PostHog] Overriding feature flags! Feature flags from server were: ' +
                    JSON.stringify(this._posthog.persistence.props['$active_feature_flags'])
            )
        this._override_warning = true
        return this._posthog.persistence.props['$override_feature_flags']
    }
    return this._posthog.persistence.props['$active_feature_flags']
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
    return this.getFlags().indexOf(key) > -1
}

/*
 * See if feature flags are available.
 *
 * ### Usage:
 *
 *     posthog.onFeatureFlags(function(featureFlags) { // do something })
 *
 * @param {Function} [callback] The callback function will be called once the feature flags are ready. It'll return a list of feature flags enabled for the user.
 */
PostHogFeatureFlags.prototype.onFeatureFlags = function (callback) {
    if (!this.getFlags()) {
        setTimeout(
            _.bind(function () {
                this._posthog.feature_flags.onFeatureFlags(callback)
            }, this),
            100
        )
        return false
    }
    callback(this.getFlags())
}
export { PostHogFeatureFlags }

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
