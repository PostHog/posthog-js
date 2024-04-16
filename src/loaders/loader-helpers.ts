import { assignableWindow, document, userAgent, window } from '../utils/globals'
import { _copyAndTruncateStrings, _each, _eachArray, _extend, _register_event } from '../utils'
import {
    _isArray,
    _isEmptyObject,
    _isEmptyString,
    _isFunction,
    _isNumber,
    _isObject,
    _isString,
    _isUndefined,
} from '../utils/type-utils'
import { PostHogConfig } from '../types'

type PostHogInstancesType = Record<string, PostHogCore>
const PRIMARY_INSTANCE_NAME = 'posthog'
import { SUPPORTS_REQUEST } from '../request'
import { PostHogCore } from '../posthog-core'

let ENQUEUE_REQUESTS = !SUPPORTS_REQUEST && userAgent?.indexOf('MSIE') === -1 && userAgent?.indexOf('Mozilla') === -1

const add_dom_loaded_handler = function (instances: PostHogInstancesType) {
    // Cross browser DOM Loaded support
    function dom_loaded_handler() {
        // function flag since we only want to execute this once
        if ((dom_loaded_handler as any).done) {
            return
        }
        ;(dom_loaded_handler as any).done = true

        ENQUEUE_REQUESTS = false

        _each(instances, function (inst: any) {
            inst._dom_loaded()
        })
    }

    if (document?.addEventListener) {
        if (document.readyState === 'complete') {
            // safari 4 can fire the DOMContentLoaded event before loading all
            // external JS (including this file). you will see some copypasta
            // on the internet that checks for 'complete' and 'loaded', but
            // 'loaded' is an IE thing
            dom_loaded_handler()
        } else {
            document.addEventListener('DOMContentLoaded', dom_loaded_handler, false)
        }
    }

    // fallback handler, always will work
    if (window) {
        _register_event(window, 'load', dom_loaded_handler, true)
    }
}

export function init_from_snippet(PostHogCls: new () => PostHogCore, instances: PostHogInstancesType): void {
    const posthogMain = (instances[PRIMARY_INSTANCE_NAME] = new PostHogCls())

    const snippetPostHog = assignableWindow['posthog']

    if (snippetPostHog) {
        /**
         * The snippet uses some clever tricks to allow deferred loading of array.js (this code)
         *
         * window.posthog is an array which the queue of calls made before the lib is loaded
         * It has methods attached to it to simulate the posthog object so for instance
         *
         * window.posthog.init("TOKEN", {api_host: "foo" })
         * window.posthog.capture("my-event", {foo: "bar" })
         *
         * ... will mean that window.posthog will look like this:
         * window.posthog == [
         *  ["my-event", {foo: "bar"}]
         * ]
         *
         * window.posthog[_i] == [
         *   ["TOKEN", {api_host: "foo" }, "posthog"]
         * ]
         *
         * If a name is given to the init function then the same as above is true but as a sub-property on the object:
         *
         * window.posthog.init("TOKEN", {}, "ph2")
         * window.posthog.ph2.people.set({foo: "bar"})
         *
         * window.posthog.ph2 == []
         * window.posthog.people == [
         *  ["set", {foo: "bar"}]
         * ]
         *
         */

        // Call all pre-loaded init calls properly

        _each(snippetPostHog['_i'], function (item: [token: string, config: Partial<PostHogConfig>, name: string]) {
            if (item && _isArray(item)) {
                const instance = posthogMain.init(item[0], item[1], item[2])

                const instanceSnippet = snippetPostHog[item[2]] || snippetPostHog

                if (instance) {
                    // Crunch through the people queue first - we queue this data up &
                    // flush on identify, so it's better to do all these operations first
                    // TODO: Fix this
                    // instance._execute_array.call(instance.people, instanceSnippet.people)
                    instance._execute_array(instanceSnippet)
                }
            }
        })
    }

    assignableWindow['posthog'] = posthogMain

    add_dom_loaded_handler(instances)
}

export function init_as_module(PostHogCls: new () => PostHogCore, instances: PostHogInstancesType): PostHogCore {
    const posthogMain = (instances[PRIMARY_INSTANCE_NAME] = new PostHogCls())

    add_dom_loaded_handler(instances)

    return posthogMain
}
