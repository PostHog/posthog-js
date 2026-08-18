import { runClientConformanceSuite } from './helpers/client-conformance'
import { createTestClient } from './helpers/test-client'

runClientConformanceSuite('TestClient', () => {
    const client = createTestClient()
    return {
        client,
        publishRemoteConfig(result) {
            client.setRemoteConfigResult(result)
        },
        dispose() {
            client.dispose()
        },
    }
})
