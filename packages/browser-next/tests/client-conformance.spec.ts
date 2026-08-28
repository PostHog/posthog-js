import type { Client, RemoteConfig, RemoteConfigResult } from '@posthog/browser-common'
import { runClientConformanceSuite } from '@posthog/browser-common/tests/client-conformance'

import { createPostHog, type Extension } from '../src/core'
import { createFetch, type SentRequest } from './helpers'

runClientConformanceSuite('browser-next', async () => {
    const requests: SentRequest[] = []
    let client: Client | undefined
    let publishRemoteConfig: ((result: RemoteConfigResult) => void) | undefined
    const extension: Extension = {
        name: 'conformance',
        setup(value) {
            client = value
        },
        dispose() {},
    }
    const posthog = await createPostHog({
        projectToken: 'ph_test',
        storage: false,
        navigator: false,
        fetch: createFetch(requests),
        initialPersonProperties: { initial: true },
        extensions: [extension],
        remoteConfigLoader: () =>
            new Promise<RemoteConfig | undefined>((resolve) => {
                publishRemoteConfig = (result) => resolve(result.ok ? result.config : undefined)
            }),
    })
    if (!client) {
        throw new Error('The conformance extension did not receive a client')
    }

    return {
        client,
        async publishRemoteConfig(result) {
            const config = posthog.getRemoteConfig()
            await Promise.resolve()
            publishRemoteConfig?.(result)
            await config
        },
        dispose: () => posthog.dispose(),
    }
})
