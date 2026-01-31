// The library depends on having the module initialized before it can be used.
import '../../entrypoints/default-extensions'

import { PostHog, init_as_module } from '../../posthog-core'
import { PostHogConfig } from '../../types'
import { PostHogPersistence } from '../../posthog-persistence'
import { assignableWindow } from '../../utils/globals'
import { uuidv7 } from '../../uuidv7'

export const createPosthogInstance = async (
    // Use a random UUID for the token, such that we don't have to worry
    // about collisions between test cases.
    token: string = uuidv7(),
    config: Partial<PostHogConfig> = {}
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
    return await new Promise<PostHog>((resolve) =>
        posthog.init(
            token,
            {
                request_batching: false,
                api_host: 'http://localhost',
                disable_surveys: true,
                disable_surveys_automatic_display: false,
                disable_conversations: true,
                before_send: () => {
                    // if we don't return null here, requests will be sent
                    // but can't go anywhere, and we get console output in tests,
                    // but it's just noise
                    return null
                },
                ...config,
                loaded: (p) => {
                    config.loaded?.(p)

                    resolve(p as PostHog)
                },
            },
            'test-' + token
        )
    )
}

const posthog = init_as_module()
export const defaultPostHog = (): PostHog => posthog

export const createMockPostHog = (overrides: Partial<PostHog> = {}): PostHog =>
    ({
        config: {
            token: 'test-token',
            api_host: 'https://test.com',
        } as PostHogConfig,
        get_distinct_id: () => 'test-distinct-id',
        get_property: jest.fn().mockReturnValue({}),
        capture: jest.fn(),
        _send_request: jest.fn(),
        ...overrides,
    }) as PostHog

export const createMockConfig = (overrides: Partial<PostHogConfig> = {}): PostHogConfig =>
    ({
        token: 'test-token',
        api_host: 'https://test.com',
        ...overrides,
    }) as PostHogConfig

export const createMockPersistence = (overrides: Partial<PostHogPersistence> = {}): PostHogPersistence =>
    ({
        register: jest.fn(),
        props: {},
        ...overrides,
    }) as PostHogPersistence
