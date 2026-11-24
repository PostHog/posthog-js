import { createBufferedPostHog as createPostHog } from './helpers'
import { createRemoteConfigFetch } from './helpers'
import type { RemoteConfig, RemoteConfigResult } from '@posthog/browser-common'
import { runClientConformanceSuite } from '@posthog/browser-common/tests/client-conformance'

import { createFetch, type SentRequest } from './helpers'
import { extensionHost } from './extension-host'

runClientConformanceSuite('browser-next', async () => {
    const requests: SentRequest[] = []
    let publishRemoteConfig: ((result: RemoteConfigResult) => void) | undefined
    const posthog = await createPostHog({
        projectToken: 'ph_test',
        storage: false,
        navigator: false,
        fetch: createRemoteConfigFetch(
            () =>
                new Promise<RemoteConfig | undefined>((resolve) => {
                    publishRemoteConfig = (result) => resolve(result.ok ? result.config : undefined)
                }),
            createFetch(requests)
        ),
        initialPersonProperties: { initial: true },
    })

    return {
        client: extensionHost(posthog),
        async publishRemoteConfig(result) {
            const config = posthog.getRemoteConfig()
            await Promise.resolve()
            publishRemoteConfig?.(result)
            await config
        },
        dispose: () => posthog.dispose(),
    }
})
