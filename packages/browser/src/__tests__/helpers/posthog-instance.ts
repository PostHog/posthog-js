// The library depends on having the module initialized before it can be used.

import { PostHog, init_as_module } from '../../posthog-core'
import { PostHogConfig } from '../../types'
import { assignableWindow } from '../../utils/globals'
import { uuidv7 } from '../../uuidv7'

export const createPosthogInstance = async (
    token: string = uuidv7(),
    config: Partial<PostHogConfig> = {},
    overrides?: Partial<PostHog>
): Promise<PostHog> => {
    // We need to create a new instance of the library for each test, to ensure
    // that they are isolated from each other. The way the library is currently
    // written, we first create an instance, then call init on it which then
    // creates another instance.
    const posthog = new PostHog()

    // NOTE: Temporary change whilst testing remote config
    assignableWindow._POSTHOG_REMOTE_CONFIG = {
        [token]: {
            config: {},
            siteApps: [],
        },
    } as any

    // eslint-disable-next-line compat/compat
    return await new Promise<PostHog>((resolve) => {
        posthog.init(
            // Use a random UUID for the token, such that we don't have to worry
            // about collisions between test cases.
            token,
            {
                request_batching: false,
                api_host: 'http://localhost',
                disable_surveys: true,
                disable_surveys_automatic_display: false,
                ...config,
                loaded: (p) => {
                    config.loaded?.(p)
                    resolve(overrides ? Object.assign(p, overrides) : p)
                },
            },
            'test-' + token
        )
        // Advance timers to ensure any setTimeout calls in init fire
        // Only run if fake timers are enabled to avoid warnings
        try {
            jest.runAllTimers()
        } catch (e) {
            // Ignore errors if fake timers aren't enabled
        }
    })
}

const posthog = init_as_module()
export const defaultPostHog = (): PostHog => {
    return posthog
}

/**
 * Helper to create a PostHog instance from the singleton with loaded callback
 * Use this when you want to test the singleton pattern that users actually use
 */
export const initPosthogWith = async (
    token: string,
    config: Partial<PostHogConfig>,
    instanceName: string,
    overrides?: Partial<PostHog>
): Promise<PostHog> => {
    return await new Promise<PostHog>((resolve) => {
        defaultPostHog().init(
            token,
            {
                ...config,
                loaded: (ph) => {
                    config.loaded?.(ph)
                    resolve(overrides ? Object.assign(ph, overrides) : ph)
                },
            },
            instanceName
        )
        // Advance timers to ensure any setTimeout calls in init fire
        // Only run if fake timers are enabled to avoid warnings
        try {
            jest.runAllTimers()
        } catch (e) {
            // Ignore errors if fake timers aren't enabled
        }
    })
}
