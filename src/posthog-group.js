/* eslint camelcase: "off" */
import { addOptOutCheckPostHogGroup } from './gdpr-utils';
import { apiActions } from './api-actions';
import { _, console } from './utils';

/**
 * PostHog Group Object
 * @constructor
 */
var PostHogGroup = function() {};

_.extend(PostHogGroup.prototype, apiActions);

PostHogGroup.prototype._init = function(posthog_instance, group_key, group_id) {
    this._posthog = posthog_instance;
    this._group_key = group_key;
    this._group_id = group_id;
};

/**
 * Set properties on a group.
 *
 * ### Usage:
 *
 *     posthog.get_group('company', 'posthog').set('Location', '405 Howard');
 *
 *     // or set multiple properties at once
 *     posthog.get_group('company', 'posthog').set({
 *          'Location': '405 Howard',
 *          'Founded' : 2009,
 *     });
 *     // properties can be strings, integers, dates, or lists
 *
 * @param {Object|String} prop If a string, this is the name of the property. If an object, this is an associative array of names and values.
 * @param {*} [to] A value to set on the given property name
 * @param {Function} [callback] If provided, the callback will be called after the captureing event
 */
PostHogGroup.prototype.set = addOptOutCheckPostHogGroup(function(prop, to, callback) {
    var data = this.set_action(prop, to);
    if (_.isObject(prop)) {
        callback = to;
    }
    return this._send_request(data, callback);
});

/**
 * Set properties on a group, only if they do not yet exist.
 * This will not overwrite previous group property values, unlike
 * group.set().
 *
 * ### Usage:
 *
 *     posthog.get_group('company', 'posthog').set_once('Location', '405 Howard');
 *
 *     // or set multiple properties at once
 *     posthog.get_group('company', 'posthog').set_once({
 *          'Location': '405 Howard',
 *          'Founded' : 2009,
 *     });
 *     // properties can be strings, integers, lists or dates
 *
 * @param {Object|String} prop If a string, this is the name of the property. If an object, this is an associative array of names and values.
 * @param {*} [to] A value to set on the given property name
 * @param {Function} [callback] If provided, the callback will be called after the captureing event
 */
PostHogGroup.prototype.set_once = addOptOutCheckPostHogGroup(function(prop, to, callback) {
    var data = this.set_once_action(prop, to);
    if (_.isObject(prop)) {
        callback = to;
    }
    return this._send_request(data, callback);
});

/**
 * Unset properties on a group permanently.
 *
 * ### Usage:
 *
 *     posthog.get_group('company', 'posthog').unset('Founded');
 *
 * @param {String} prop The name of the property.
 * @param {Function} [callback] If provided, the callback will be called after the captureing event
 */
PostHogGroup.prototype.unset = addOptOutCheckPostHogGroup(function(prop, callback) {
    var data = this.unset_action(prop);
    return this._send_request(data, callback);
});

/**
 * Merge a given list with a list-valued group property, excluding duplicate values.
 *
 * ### Usage:
 *
 *     // merge a value to a list, creating it if needed
 *     posthog.get_group('company', 'posthog').union('Location', ['San Francisco', 'London']);
 *
 * @param {String} list_name Name of the property.
 * @param {Array} values Values to merge with the given property
 * @param {Function} [callback] If provided, the callback will be called after the captureing event
 */
PostHogGroup.prototype.union = addOptOutCheckPostHogGroup(function(list_name, values, callback) {
    if (_.isObject(list_name)) {
        callback = values;
    }
    var data = this.union_action(list_name, values);
    return this._send_request(data, callback);
});

/**
 * Permanently delete a group.
 *
 * ### Usage:
 *     posthog.get_group('company', 'posthog').delete();
 */
PostHogGroup.prototype['delete'] = addOptOutCheckPostHogGroup(function(callback) {
    var data = this.delete_action();
    return this._send_request(data, callback);
});

/**
 * Remove a property from a group. The value will be ignored if doesn't exist.
 *
 * ### Usage:
 *
 *     posthog.get_group('company', 'posthog').remove('Location', 'London');
 *
 * @param {String} list_name Name of the property.
 * @param {Object} value Value to remove from the given group property
 * @param {Function} [callback] If provided, the callback will be called after the captureing event
 */
PostHogGroup.prototype.remove = addOptOutCheckPostHogGroup(function(list_name, value, callback) {
    var data = this.remove_action(list_name, value);
    return this._send_request(data, callback);
});

PostHogGroup.prototype._send_request = function(data, callback) {
    data['$group_key'] = this._group_key;
    data['$group_id'] = this._group_id;
    data['$token'] = this._get_config('token');

    var date_encoded_data = _.encodeDates(data);
    var truncated_data    = _.truncate(date_encoded_data, 255);
    var json_data         = _.JSONEncode(date_encoded_data);
    var encoded_data      = _.base64Encode(json_data);

    console.log(data);
    this._posthog._send_request(
        this._posthog.get_config('api_host') + '/groups/',
        {'data': encoded_data},
        this._posthog._prepare_callback(callback, truncated_data)
    );

    return truncated_data;
};

PostHogGroup.prototype._is_reserved_property = function(prop) {
    return prop === '$group_key' || prop === '$group_id';
};

PostHogGroup.prototype._get_config = function(conf) {
    return this._posthog.get_config(conf);
};

PostHogGroup.prototype.toString = function() {
    return this._posthog.toString() + '.group.' + this._group_key + '.' + this._group_id;
};

// PostHogGroup Exports
PostHogGroup.prototype['remove']   = PostHogGroup.prototype.remove;
PostHogGroup.prototype['set']      = PostHogGroup.prototype.set;
PostHogGroup.prototype['set_once'] = PostHogGroup.prototype.set_once;
PostHogGroup.prototype['union']    = PostHogGroup.prototype.union;
PostHogGroup.prototype['unset']    = PostHogGroup.prototype.unset;
PostHogGroup.prototype['toString'] = PostHogGroup.prototype.toString;

export {PostHogGroup};
