// The library depends on having the module initialized before it can be used.

import { v4 } from 'uuid'
import { PostHog, init_as_module } from '../../posthog-core'
import 'regenerator-runtime/runtime'
import { PostHogConfig } from '../../types'
import { _base64Encode } from '../../utils'

// It sets a global variable that is set and used to initialize subsequent libaries.
beforeAll(() => init_as_module())

jest.mock('../../utils/globals', () => ({
    ...jest.requireActual('../../utils/globals'),
    fetch: jest.fn(),
}))

const { fetch } = jest.requireMock('../../utils/globals')

export const createPosthogInstance = async (
    token: string = v4(),
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
            'test'
        )
    )
}

export type PostHogTestHarness = {
    fetch: jest.Mock
    decodeFetchRequests: () => Promise<any[]>
    posthog: PostHog
}

export const createPostHogTestHarness = async (
    token: string = v4(),
    config: Partial<PostHogConfig> = {}
): Promise<PostHogTestHarness> => {
    const posthog = await createPosthogInstance(token, config)

    fetch.mockClear()
    return {
        posthog,
        decodeFetchRequests: () => {
            console.log(fetch.mock.calls)

            return fetch.mock.calls.map(([url, options]) => {
                let json = undefined

                try {
                    json = options.body
                        ? JSON.parse(
                              Buffer.from(decodeURIComponent(options.body.replace('data=', '')), 'base64').toString()
                          )
                        : undefined
                } catch (e) {}

                return {
                    url,
                    ...options,
                    json,
                }
            })
        },
        fetch,
    }
}
