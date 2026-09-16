import type { RemoteConfig } from '@posthog/browser-common'

import { sendRequest, type RequestRuntime } from './request'

export const loadRemoteConfig = async (
    runtime: RequestRuntime,
    signal: AbortSignal | undefined,
    canSend: () => boolean
): Promise<RemoteConfig | undefined> => {
    const response = await sendRequest(
        runtime,
        `/array/${encodeURIComponent(runtime[1])}/config`,
        { target: 'assets' },
        canSend,
        signal
    )
    const config = response.json
    return response.statusCode >= 200 &&
        response.statusCode < 300 &&
        config !== null &&
        typeof config === 'object' &&
        !Array.isArray(config)
        ? (config as RemoteConfig)
        : undefined
}
