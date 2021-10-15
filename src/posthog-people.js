/* eslint camelcase: "off" */
import { addOptOutCheckPostHogPeople } from './gdpr-utils'
import { SET_ACTION, apiActions } from './api-actions'
import { _ } from './utils'

/**
 * PostHog People Object
 * @constructor
 */
var PostHogPeople = function () {}

_.extend(PostHogPeople.prototype, apiActions)

PostHogPeople.prototype._init = function (posthog_instance) {
    this._posthog = posthog_instance
}

/*
 * Set properties on a user record.
 *
 * ### Usage:
 *
 *     posthog.people.set('gender', 'm');
 *
 *     // or set multiple properties at once
 *     posthog.people.set({
 *         'Company': 'Acme',
 *         'Plan': 'Premium',
 *         'Upgrade date': new Date()
 *     });
 *     // properties can be strings, integers, dates, or lists
 *
 * @param {Object|String} prop If a string, this is the name of the property. If an object, this is an associative array of names and values.
 * @param {*} [to] A value to set on the given property name
 * @param {Function} [callback] If provided, the callback will be called after captureing the event.
 */
PostHogPeople.prototype.set = addOptOutCheckPostHogPeople(function (prop, to, callback) {
    var data = this.set_action(prop, to)
    if (_.isObject(prop)) {
        callback = to
    }
    // make sure that the referrer info has been updated and saved
    if (this._get_config('save_referrer')) {
        this._posthog['persistence'].update_referrer_info(document.referrer)
    }

    // update $set object with default people properties
    data[SET_ACTION] = _.extend(
        {},
        _.info.people_properties(),
        this._posthog['persistence'].get_referrer_info(),
        data[SET_ACTION]
    )
    return this._send_request(data, callback)
})

/*
 * Set properties on a user record, only if they do not yet exist.
 * This will not overwrite previous people property values, unlike
 * people.set().
 *
 * ### Usage:
 *
 *     posthog.people.set_once('First Login Date', new Date());
 *
 *     // or set multiple properties at once
 *     posthog.people.set_once({
 *         'First Login Date': new Date(),
 *         'Starting Plan': 'Premium'
 *     });
 *
 *     // properties can be strings, integers or dates
 *
 * @param {Object|String} prop If a string, this is the name of the property. If an object, this is an associative array of names and values.
 * @param {*} [to] A value to set on the given property name
 * @param {Function} [callback] If provided, the callback will be called after captureing the event.
 */
PostHogPeople.prototype.set_once = addOptOutCheckPostHogPeople(function (prop, to, callback) {
    var data = this.set_once_action(prop, to)
    if (_.isObject(prop)) {
        callback = to
    }
    return this._send_request(data, callback)
})

PostHogPeople.prototype.toString = function () {
    return this._posthog.toString() + '.people'
}

PostHogPeople.prototype._send_request = function (data, callback) {
    data['$token'] = this._get_config('token')
    data['$distinct_id'] = this._posthog.get_distinct_id()
    var device_id = this._posthog.get_property('$device_id')
    var user_id = this._posthog.get_property('$user_id')
    var had_persisted_distinct_id = this._posthog.get_property('$had_persisted_distinct_id')
    if (device_id) {
        data['$device_id'] = device_id
    }
    if (user_id) {
        data['$user_id'] = user_id
    }
    if (had_persisted_distinct_id) {
        data['$had_persisted_distinct_id'] = had_persisted_distinct_id
    }

    var date_encoded_data = _.encodeDates(data)
    var truncated_data = _.copyAndTruncateStrings(date_encoded_data, this._get_config('properties_string_max_length'))
    var json_data = JSON.stringify(date_encoded_data)
    var encoded_data = _.base64Encode(json_data)

    this._posthog._send_request(
        this._get_config('api_host') + '/engage/',
        { data: encoded_data },
        {},
        this._posthog._prepare_callback(callback, truncated_data)
    )

    return truncated_data
}

PostHogPeople.prototype._get_config = function (conf_var) {
    return this._posthog.get_config(conf_var)
}

PostHogPeople.prototype._is_reserved_property = function (prop) {
    return (
        prop === '$distinct_id' ||
        prop === '$token' ||
        prop === '$device_id' ||
        prop === '$user_id' ||
        prop === '$had_persisted_distinct_id'
    )
}

// PostHogPeople Exports
PostHogPeople.prototype['set'] = PostHogPeople.prototype.set
PostHogPeople.prototype['set_once'] = PostHogPeople.prototype.set_once
PostHogPeople.prototype['toString'] = PostHogPeople.prototype.toString

export { PostHogPeople }
