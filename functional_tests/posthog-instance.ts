// The library depends on having the module initialized before it can be used.

import { v4 } from 'uuid'
import { PostHog, init_as_module } from '../src/posthog-core'
import 'regenerator-runtime/runtime'
import { PostHogConfig } from '../src/types'

// It sets a global variable that is set and used to initialize subsequent libaries.
beforeAll(() => init_as_module())

export const createPosthogInstance = async (token: string = v4(), config: Partial<PostHogConfig> = {}) => {
    // We need to create a new instance of the library for each test, to ensure
    // that they are isolated from each other. The way the library is currently
    // written, we first create an instance, then call init on it which then
    // creates another instance.
    const posthog = new PostHog()
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
            'test'
        )
    )
}
