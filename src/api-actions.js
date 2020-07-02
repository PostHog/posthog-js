/* eslint camelcase: "off" */

import { _ } from './utils'

/** @const */ var SET_ACTION = '$set'
/** @const */ var SET_ONCE_ACTION = '$set_once'

// Common internal methods for posthog.people and posthog.group APIs.
// These methods shouldn't involve network I/O.
var apiActions = {
    set_action: function (prop, to) {
        var data = {}
        var $set = {}
        if (_.isObject(prop)) {
            _.each(
                prop,
                function (v, k) {
                    if (!this._is_reserved_property(k)) {
                        $set[k] = v
                    }
                },
                this
            )
        } else {
            $set[prop] = to
        }

        data[SET_ACTION] = $set
        return data
    },

    set_once_action: function (prop, to) {
        var data = {}
        var $set_once = {}
        if (_.isObject(prop)) {
            _.each(
                prop,
                function (v, k) {
                    if (!this._is_reserved_property(k)) {
                        $set_once[k] = v
                    }
                },
                this
            )
        } else {
            $set_once[prop] = to
        }
        data[SET_ONCE_ACTION] = $set_once
        return data
    },
}

export { SET_ACTION, SET_ONCE_ACTION, apiActions }
