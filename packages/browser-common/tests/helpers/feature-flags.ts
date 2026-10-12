import type { FeatureFlagsConfig } from '../../src/feature-flags-config'
import { PostHogFeatureFlags } from '../../src/feature-flags'
import { logger } from '../../src/utils/logger'
import { createTestClient, type TestClient, type TestClientOptions } from './test-client'

export type MutableConfig = { -readonly [K in keyof FeatureFlagsConfig]: FeatureFlagsConfig[K] }

export function createConfig(overrides: Partial<FeatureFlagsConfig> = {}): MutableConfig {
    return {
        bootstrap: {},
        remoteRequestsDisabled: false,
        featureFlagsDisabled: false,
        onlyEvaluateSurveyFeatureFlags: false,
        deduplicateCallsPerSession: false,
        idleRefreshBackoff: false,
        requestTimeoutMs: 3000,
        compression: 'best-available',
        evaluationContexts: [],
        ...overrides,
    }
}

export function createFlagsClient(options: TestClientOptions = {}): TestClient {
    const client = createTestClient({ projectToken: 'random fake token', distinctId: 'blah id', logger, ...options })
    client.deviceId = undefined
    vi.spyOn(client, 'capture').mockImplementation(() => {})
    vi.spyOn(client, 'sendRequest').mockResolvedValue({ statusCode: 200, json: {} })
    return client
}

const extensions: PostHogFeatureFlags[] = []

export function setupFlags(client: TestClient, config: FeatureFlagsConfig): PostHogFeatureFlags {
    const flags = new PostHogFeatureFlags({ get: () => config })
    extensions.push(flags)
    flags.setup(client)
    return flags
}

export function disposeFlags(): void {
    extensions.splice(0).forEach((flags) => flags.dispose())
}
