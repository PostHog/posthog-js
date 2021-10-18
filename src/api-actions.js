/* eslint camelcase: "off" */

import { _ } from './utils'

/** @const */ var SET_ACTION = '$set'
/** @const */ var SET_ONCE_ACTION = '$set_once'

// Internal methods for posthog.people API.
// These methods shouldn't involve network I/O.
var apiActions = {
    set_action: function (prop, to) {
        return this.apiActionParser(SET_ACTION, prop, to)
    },

    set_once_action: function (prop, to) {
        return this.apiActionParser(SET_ONCE_ACTION, prop, to)
    },

    apiActionParser: function (actionType, prop, to) {
        var data = {}
        var props = {}

        if (_.isObject(prop)) {
            _.each(
                prop,
                function (v, k) {
                    if (!this._is_reserved_property(k)) {
                        props[k] = v
                    }
                },
                this
            )
        } else {
            props[prop] = to
        }

        data[actionType] = props
        return data
    },
}

export { SET_ACTION, apiActions }
