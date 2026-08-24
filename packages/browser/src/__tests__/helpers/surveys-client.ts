import type { ApiResponse, Client, SendRequestInit } from '@posthog/browser-common'

import type { PostHog } from '../../posthog-core'

export const createSurveysClient = (posthog: PostHog): Client =>
    ({
        projectToken: posthog.config.token,
        kv: {
            initialize: () => {},
            get: (key: string) => posthog.get_property(key),
            set: (keyOrValues: string | Record<string, unknown>, value?: unknown) =>
                posthog.persistence?.register(
                    (typeof keyOrValues === 'string' ? { [keyOrValues]: value } : keyOrValues) as any
                ),
            remove: (keyOrKeys: string | readonly string[]) => posthog.persistence?.unregister(keyOrKeys),
        },
        onRemoteConfig: () => ({ dispose: () => {} }),
        sendRequest: (path: string, init: SendRequestInit = {}): Promise<ApiResponse> =>
            new Promise((resolve) => {
                posthog._send_request({
                    url: posthog.requestRouter.endpointFor(
                        init.target ?? 'api',
                        `${path}?token=${init.query?.token ?? ''}`
                    ),
                    method: init.method,
                    timestampMode: init.sentAt,
                    timeout: init.timeoutMs,
                    fireCallbackOnDrop: true,
                    callback: resolve,
                })
            }),
    }) as Client
