/* eslint camelcase: "off" */
import { addOptOutCheck } from './gdpr-utils'
import { _base64Encode, _copyAndTruncateStrings, _each, _encodeDates, _extend, _info, _isObject } from './utils'
import { PostHogConfig, Properties, RequestCallback } from './types'
import { PostHog } from './posthog-core'

const SET_ACTION = '$set'
const SET_ONCE_ACTION = '$set_once'

/**
 * PostHog People Object
 * @constructor
 */
class PostHogPeople {
    _posthog: PostHog

    set: (prop: string | Properties, to?: string, callback?: RequestCallback) => void
    set_once: (prop: string | Properties, to?: string, callback?: RequestCallback) => void

    constructor(posthog: PostHog) {
        this._posthog = posthog

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
         * @param {Function} [callback] If provided, the callback will be called after capturing the event.
         */
        this.set = addOptOutCheck(posthog, (prop: string | Properties, to?: string, callback?: RequestCallback) => {
            const data = this.set_action(prop, to)

            // Update current user properties
            this._posthog.setPersonPropertiesForFlags(data['$set'] || {})

            if (_isObject(prop)) {
                callback = to as any
            }
            // make sure that the referrer info has been updated and saved
            if (this._get_config('save_referrer')) {
                this._posthog.sessionPersistence.update_referrer_info()
            }

            // update $set object with default people properties
            data[SET_ACTION] = _extend(
                {},
                _info.people_properties(),
                this._posthog.sessionPersistence.get_referrer_info(),
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
         * @param {Function} [callback] If provided, the callback will be called after capturing the event.
         */
        this.set_once = addOptOutCheck(
            posthog,
            (prop: string | Properties, to?: string, callback?: RequestCallback) => {
                const data = this.set_once_action(prop, to)
                if (_isObject(prop)) {
                    callback = to as any
                }
                return this._send_request(data, callback)
            }
        )
    }

    toString(): string {
        return this._posthog.toString() + '.people'
    }

    _send_request(data: Properties, callback?: RequestCallback): Properties {
        data['$token'] = this._get_config('token')
        data['$distinct_id'] = this._posthog.get_distinct_id()
        const device_id = this._posthog.get_property('$device_id')
        const user_id = this._posthog.get_property('$user_id')
        const had_persisted_distinct_id = this._posthog.get_property('$had_persisted_distinct_id')
        if (device_id) {
            data['$device_id'] = device_id
        }
        if (user_id) {
            data['$user_id'] = user_id
        }
        if (had_persisted_distinct_id) {
            data['$had_persisted_distinct_id'] = had_persisted_distinct_id
        }

        const date_encoded_data = _encodeDates(data)
        const truncated_data = _copyAndTruncateStrings(
            date_encoded_data,
            this._get_config('properties_string_max_length')
        )
        const json_data = JSON.stringify(date_encoded_data)
        const encoded_data = _base64Encode(json_data)

        this._posthog._send_request(
            this._get_config('api_host') + '/engage/',
            { data: encoded_data },
            {},
            this._posthog._prepare_callback(callback, truncated_data) as RequestCallback
        )

        return truncated_data
    }

    _get_config<K extends keyof PostHogConfig>(conf_var: K): PostHogConfig[K] {
        return this._posthog.get_config(conf_var)
    }

    _is_reserved_property(prop: string): boolean {
        return (
            prop === '$distinct_id' ||
            prop === '$token' ||
            prop === '$device_id' ||
            prop === '$user_id' ||
            prop === '$had_persisted_distinct_id'
        )
    }

    // Internal methods for posthog.people API.
    // These methods shouldn't involve network I/O.
    private set_action(prop: string | Properties, to?: string): Properties {
        return this.apiActionParser(SET_ACTION, prop, to)
    }

    private set_once_action(prop: string | Properties, to?: string): Properties {
        return this.apiActionParser(SET_ONCE_ACTION, prop, to)
    }

    private apiActionParser(actionType: '$set' | '$set_once', prop: string | Properties, to?: string): Properties {
        const data: Properties = {}
        const props: Properties = {}

        if (_isObject(prop)) {
            _each(prop, (v, k: string) => {
                if (!(this as any)._is_reserved_property(k)) {
                    props[k] = v
                }
            })
        } else {
            props[prop] = to
        }

        data[actionType] = props
        return data
    }
}

export { PostHogPeople }
