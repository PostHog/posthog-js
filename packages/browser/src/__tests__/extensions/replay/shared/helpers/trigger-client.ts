import type { ReplayTriggerClient } from '@posthog/browser-common/replay/host'
import { createDisposable } from '@posthog/browser-common'
import { InMemoryKeyValueStore } from '../../../../../../../browser-common/tests/helpers/test-client'

export function createTriggerClient(getTargetingUrl: () => string | undefined = () => undefined): ReplayTriggerClient {
    return {
        kv: new InMemoryKeyValueStore(),
        replay: {
            get targetingUrl() {
                return getTargetingUrl()
            },
            registerSessionProperties: () => {},
            onFlags: () => createDisposable(() => {}),
        },
    }
}
