import { assignableWindow } from '../utils/globals'
import { PostHogConfig } from '../types'

type PostHogInstancesType = Record<string, PostHogCore>
const PRIMARY_INSTANCE_NAME = 'posthog'
import { PostHogCore } from '../posthog-core'
import { each } from '../utils'
import { isArray } from '../utils/type-utils'

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

        each(snippetPostHog['_i'], function (item: [token: string, config: Partial<PostHogConfig>, name: string]) {
            if (item && isArray(item)) {
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
}

export function init_as_module(PostHogCls: new () => PostHogCore, instances: PostHogInstancesType): PostHogCore {
    const posthogMain = (instances[PRIMARY_INSTANCE_NAME] = new PostHogCls())

    return posthogMain
}
