import type { ReplayTriggerClient } from '../../../src/replay/host'
import { createDisposable } from '../../../src/index'
import { InMemoryKeyValueStore } from '../../helpers/test-client'

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
