import { PostHogRemoteConfig } from '@/types'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks, waitForPromises } from '@/testing'

// Subclass to track onRemoteConfig calls
class TestClientWithRemoteConfig extends PostHogCoreTestClient {
  public onRemoteConfigCalls: PostHogRemoteConfig[] = []

  protected onRemoteConfig(response: PostHogRemoteConfig): void {
    this.onRemoteConfigCalls.push(response)
  }
}

const createTestClientWithRemoteConfig = (
  apiKey: string,
  options?: Parameters<typeof createTestClient>[1],
  setupMocks?: Parameters<typeof createTestClient>[2],
  storageCache?: Parameters<typeof createTestClient>[3]
): [TestClientWithRemoteConfig, PostHogCoreTestClientMocks] => {
  const [, mocks] = createTestClient(apiKey, options, setupMocks, storageCache)
  const client = new TestClientWithRemoteConfig(mocks, apiKey, { disableCompression: true, ...options })
  return [client, mocks]
}

describe('PostHog onRemoteConfig', () => {
  let posthog: TestClientWithRemoteConfig
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()
  jest.setSystemTime(new Date('2022-01-01'))

  afterEach(async () => {
    await posthog.shutdown()
  })

  describe('user-triggered reloadFeatureFlags', () => {
    it('does not fire onRemoteConfig on user-triggered reloadFeatureFlagsAsync', async () => {
      const flagsResponse = {
        flags: {},
        featureFlags: {},
        featureFlagPayloads: {},
        requestId: 'req-1',
        errorTracking: { autocaptureExceptions: true },
        capturePerformance: { network_timing: true, web_vitals: false },
        sessionRecording: { endpoint: '/s/', consoleLogRecordingEnabled: true },
      }

      ;[posthog, mocks] = createTestClientWithRemoteConfig(
        'TEST_API_KEY',
        {
          flushAt: 1,
          preloadFeatureFlags: false,
        },
        (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve(flagsResponse),
              })
            }
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        }
      )

      await posthog.reloadFeatureFlagsAsync()
      await waitForPromises()

      // User-triggered reloadFeatureFlagsAsync should NOT fire onRemoteConfig
      // Only the initial load via _remoteConfigAsync should trigger it
      expect(posthog.onRemoteConfigCalls).toHaveLength(0)
    })

    it('does not fire onRemoteConfig when flags request fails', async () => {
      ;[posthog, mocks] = createTestClientWithRemoteConfig(
        'TEST_API_KEY',
        {
          flushAt: 1,
          preloadFeatureFlags: false,
        },
        (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/flags/')) {
              return Promise.resolve({
                status: 500,
                text: () => Promise.resolve('error'),
                json: () => Promise.resolve({ status: 'error' }),
              })
            }
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        }
      )

      await posthog.reloadFeatureFlagsAsync()
      await waitForPromises()

      expect(posthog.onRemoteConfigCalls).toHaveLength(0)
    })
  })

  describe('via remote config endpoint (no flags)', () => {
    it('fires onRemoteConfig from remote config when hasFeatureFlags is false', async () => {
      const remoteConfigResponse = {
        hasFeatureFlags: false,
        supportedCompression: ['gzip-js'],
        errorTracking: { autocaptureExceptions: true },
        capturePerformance: { network_timing: false },
        sessionRecording: false,
        surveys: false,
      }

      ;[posthog, mocks] = createTestClientWithRemoteConfig(
        'TEST_API_KEY',
        {
          flushAt: 1,
          preloadFeatureFlags: true,
          disableRemoteConfig: false,
        },
        (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/config')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve(remoteConfigResponse),
              })
            }
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        }
      )

      await posthog.reloadRemoteConfigAsync()
      await waitForPromises()

      expect(posthog.onRemoteConfigCalls).toHaveLength(1)
      expect(posthog.onRemoteConfigCalls[0]).toMatchObject({
        errorTracking: { autocaptureExceptions: true },
        capturePerformance: { network_timing: false },
      })
    })

    it('fires onRemoteConfig from remote config when preloadFeatureFlags is false', async () => {
      const remoteConfigResponse = {
        hasFeatureFlags: true,
        supportedCompression: ['gzip-js'],
        errorTracking: false,
        capturePerformance: false,
        sessionRecording: false,
        surveys: false,
      }

      ;[posthog, mocks] = createTestClientWithRemoteConfig(
        'TEST_API_KEY',
        {
          flushAt: 1,
          preloadFeatureFlags: false,
          disableRemoteConfig: false,
        },
        (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/config')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve(remoteConfigResponse),
              })
            }
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        }
      )

      await posthog.reloadRemoteConfigAsync()
      await waitForPromises()

      // Should fire from _remoteConfigAsync since preloadFeatureFlags is false (won't load flags)
      expect(posthog.onRemoteConfigCalls).toHaveLength(1)
      expect(posthog.onRemoteConfigCalls[0]).toMatchObject({
        errorTracking: false,
        capturePerformance: false,
      })
    })
  })

  describe('fires exactly once', () => {
    it('fires from flags path (not remote config path) when remote config triggers flag reload', async () => {
      const remoteConfigResponse = {
        hasFeatureFlags: true,
        supportedCompression: ['gzip-js'],
        errorTracking: { autocaptureExceptions: true },
        capturePerformance: { network_timing: true },
        sessionRecording: false,
        surveys: false,
      }

      const flagsResponse = {
        flags: {},
        featureFlags: {},
        featureFlagPayloads: {},
        requestId: 'req-flags',
        errorTracking: { autocaptureExceptions: false },
        capturePerformance: { network_timing: false },
      }

      ;[posthog, mocks] = createTestClientWithRemoteConfig(
        'TEST_API_KEY',
        {
          flushAt: 1,
          preloadFeatureFlags: true,
          disableRemoteConfig: false,
        },
        (_mocks) => {
          _mocks.fetch.mockImplementation((url) => {
            if (url.includes('/config')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve(remoteConfigResponse),
              })
            }
            if (url.includes('/flags/')) {
              return Promise.resolve({
                status: 200,
                text: () => Promise.resolve('ok'),
                json: () => Promise.resolve(flagsResponse),
              })
            }
            return Promise.resolve({
              status: 200,
              text: () => Promise.resolve('ok'),
              json: () => Promise.resolve({ status: 'ok' }),
            })
          })
        }
      )

      await posthog.reloadRemoteConfigAsync()
      await waitForPromises()

      // Should fire exactly once — from the flags path, not the remote config path
      // because hasFeatureFlags=true and preloadFeatureFlags=true
      expect(posthog.onRemoteConfigCalls).toHaveLength(1)
      // The callback should receive the flags response (which has the latest values)
      expect(posthog.onRemoteConfigCalls[0]).toMatchObject({
        errorTracking: { autocaptureExceptions: false },
        capturePerformance: { network_timing: false },
      })
    })
  })
})
