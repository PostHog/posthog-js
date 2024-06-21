// The library depends on having the module initialized before it can be used.

import { PostHog, init_as_module } from '../../posthog-core'
import { PostHogConfig } from '../../types'
import { uuidv7 } from '../../uuidv7'

export const createPosthogInstance = async (
    token: string = uuidv7(),
    config: Partial<PostHogConfig> = {}
): Promise<PostHog> => {
    // We need to create a new instance of the library for each test, to ensure
    // that they are isolated from each other. The way the library is currently
    // written, we first create an instance, then call init on it which then
    // creates another instance.
    const posthog = new PostHog()
    // eslint-disable-next-line compat/compat
    return await new Promise<PostHog>((resolve) =>
        posthog.init(
            // Use a random UUID for the token, such that we don't have to worry
            // about collisions between test cases.
            token,
            {
                request_batching: false,
                api_host: 'http://localhost',
                ...config,
                loaded: (p) => {
                    config.loaded?.(p)

                    resolve(p)
                },
            },
            'test-' + token
        )
    )
}

const posthog = init_as_module()
export const defaultPostHog = (): PostHog => {
    return posthog
}
