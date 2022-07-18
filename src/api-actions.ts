import { _each, _isObject } from './utils'
import { Properties } from './types'

const SET_ACTION = '$set'
const SET_ONCE_ACTION = '$set_once'

// Internal methods for posthog.people API.
// These methods shouldn't involve network I/O.
const apiActions = {
    set_action: function (prop: string, to: string): Properties {
        return this.apiActionParser(SET_ACTION, prop, to)
    },

    set_once_action: function (prop: string, to: string): Properties {
        return this.apiActionParser(SET_ONCE_ACTION, prop, to)
    },

    apiActionParser: function (actionType: '$set' | '$set_once', prop: string | Properties, to: string): Properties {
        const data: Properties = {}
        const props: Properties = {}

        if (_isObject(prop)) {
            _each(prop, (v, k: string) => {
                // TODO: this will be merged into posthog-people, convert to a true class so that this works without any
                if (!(this as any)._is_reserved_property(k)) {
                    props[k] = v
                }
            })
        } else {
            props[prop] = to
        }

        data[actionType] = props
        return data
    },
}

export { SET_ACTION, apiActions }
