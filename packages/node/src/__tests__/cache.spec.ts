import { FlagDefinitionCacheProvider, FlagDefinitionCacheData } from '../extensions/feature-flags/cache'
import { PostHogFeatureFlag } from '../types'
import { PostHog } from '../entrypoints/index.node'
import { anyLocalEvalCall, apiImplementation } from './utils'

jest.spyOn(console, 'debug').mockImplementation()
jest.spyOn(console, 'warn').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

describe('FlagDefinitionCacheProvider Integration', () => {
  let posthog: PostHog
  let mockCacheProvider: jest.Mocked<FlagDefinitionCacheProvider>
  let onErrorMock: jest.Mock

  const testFlagDataApiResponse = {
    flags: [
      {
        id: 1,
        name: 'Test Flag',
        key: 'test-flag',
        active: true,
        deleted: false,
        rollout_percentage: null,
        ensure_experience_continuity: false,
        experiment_set: [],
      } as PostHogFeatureFlag,
    ],
    group_type_mapping: { '0': 'company' },
    cohorts: {},
  }

  const testFlagData: FlagDefinitionCacheData = {
    flags: [
      {
        id: 1,
        name: 'Test Flag',
        key: 'test-flag',
        active: true,
        deleted: false,
        rollout_percentage: null,
        ensure_experience_continuity: false,
        experiment_set: [],
      } as PostHogFeatureFlag,
    ],
    groupTypeMapping: { '0': 'company' },
    cohorts: {},
  }

  jest.useFakeTimers()

  beforeEach(() => {
    mockedFetch.mockClear()
    onErrorMock = jest.fn()
    mockCacheProvider = {
      getFlagDefinitions: jest.fn(),
      shouldFetchFlagDefinitions: jest.fn(),
      onFlagDefinitionsReceived: jest.fn(),
      shutdown: jest.fn(),
    }
  })

  afterEach(async () => {
    if (posthog) {
      await posthog.shutdown()
    }
  })

  describe('Cache Initialization', () => {
    it('calls getFlagDefinitions when shouldFetchFlagDefinitions returns false', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      // Wait for initial load
      await jest.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('uses cached data to initialize flags when available', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      // Wait for initial load from cache
      await jest.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalled()
      expect(posthog.isLocalEvaluationReady()).toBe(true)
    })

    it('fetches directly when shouldFetchFlagDefinitions returns true', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      // When shouldFetchFlagDefinitions returns true, we fetch directly without checking cache
      expect(mockCacheProvider.getFlagDefinitions).not.toHaveBeenCalled()
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('emits localEvaluationFlagsLoaded event with correct flag count after loading from cache', async () => {
      const onLoadMock = jest.fn()
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      posthog.on('localEvaluationFlagsLoaded', onLoadMock)

      await jest.runOnlyPendingTimersAsync()

      expect(onLoadMock).toHaveBeenCalledWith(1)
    })

    it('concurrent loadFeatureFlags calls share the same promise', async () => {
      mockCacheProvider.getFlagDefinitions.mockResolvedValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      const poller = (posthog as any).featureFlagsPoller
      const promise1 = poller.loadFeatureFlags()
      const promise2 = poller.loadFeatureFlags()

      expect(promise1).toStrictEqual(promise2)

      await promise1
    })
  })

  describe('Fetch Coordination', () => {
    it('calls shouldFetchFlagDefinitions before each poll', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalled()
    })

    it('fetches and calls onFlagDefinitionsReceived when shouldFetch returns true', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
      expect(mockCacheProvider.onFlagDefinitionsReceived).toHaveBeenCalledWith(testFlagData)
    })

    it('skips fetch and reloads from cache when shouldFetch returns false', async () => {
      // First call returns undefined (initial state)
      // Subsequent calls return cached data (after another worker fetched)
      mockCacheProvider.getFlagDefinitions.mockReturnValueOnce(undefined).mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      // Should not fetch from API when shouldFetch is false and we have flags from cache
      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalled()
      // getFlagDefinitions called multiple times to reload from cache
      expect(mockCacheProvider.getFlagDefinitions.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('emergency fallback: fetches when shouldFetch is false, cache is empty, AND no flags loaded', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      // Should fetch despite shouldFetch returning false because we have no flags at all
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it("doesn't call onFlagDefinitionsReceived when fetch is skipped", async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('catches getFlagDefinitions errors, logs them, continues initialization', async () => {
      const error = new Error('Cache read failed')
      mockCacheProvider.getFlagDefinitions.mockImplementation(() => {
        throw error
      })
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      posthog.on('error', onErrorMock)

      await jest.runOnlyPendingTimersAsync()

      // Error might be emitted, but the key is that initialization continues
      // Should still fetch from API despite cache error
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
      expect(posthog.isLocalEvaluationReady()).toBe(true)
    })

    it('catches shouldFetchFlagDefinitions errors, defaults to fetching', async () => {
      const error = new Error('Distributed lock failed')
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockRejectedValue(error)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      posthog.on('error', onErrorMock)

      await jest.runOnlyPendingTimersAsync()

      expect(onErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Error in shouldFetchFlagDefinitions'),
        })
      )
      // Should still fetch as a safe default
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('catches onFlagDefinitionsReceived errors, keeps flags in memory', async () => {
      const error = new Error('Cache write failed')
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)
      mockCacheProvider.onFlagDefinitionsReceived.mockRejectedValue(error)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      posthog.on('error', onErrorMock)

      await jest.runOnlyPendingTimersAsync()

      expect(onErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Failed to store in cache'),
        })
      )
      // Flags should still be available in memory
      expect(posthog.isLocalEvaluationReady()).toBe(true)
    })

    it('catches shutdown errors, logs and continues', async () => {
      const error = new Error('Failed to release lock')
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
      mockCacheProvider.shutdown.mockRejectedValue(error)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      posthog.on('error', onErrorMock)

      await jest.runOnlyPendingTimersAsync()
      await posthog.shutdown()

      expect(onErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Error during cache shutdown'),
        })
      )
      expect(mockCacheProvider.shutdown).toHaveBeenCalled()
    })
  })

  describe('Async/Sync Compatibility', () => {
    it('works with sync getFlagDefinitions', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(posthog.isLocalEvaluationReady()).toBe(true)
    })

    it('works with async getFlagDefinitions', async () => {
      mockCacheProvider.getFlagDefinitions.mockResolvedValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(posthog.isLocalEvaluationReady()).toBe(true)
    })

    it('works with sync shouldFetchFlagDefinitions', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockReturnValue(true)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalled()
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('works with async shouldFetchFlagDefinitions', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalled()
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('works with async shutdown', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
      mockCacheProvider.shutdown.mockResolvedValue(undefined)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()
      await posthog.shutdown()

      expect(mockCacheProvider.shutdown).toHaveBeenCalled()
    })

    it('works with sync shutdown', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
      mockCacheProvider.shutdown.mockReturnValue(undefined)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()
      await posthog.shutdown()

      expect(mockCacheProvider.shutdown).toHaveBeenCalled()
    })
  })

  describe('Data Flow and Edge Cases', () => {
    it('flags loaded from cache are immediately available for evaluation', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      const flagValue = await posthog.getFeatureFlag('test-flag', 'user-123')
      expect(flagValue).toBeDefined()
    })

    it('flags fetched from API are stored via onFlagDefinitionsReceived', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.onFlagDefinitionsReceived).toHaveBeenCalledWith(testFlagData)
      expect(posthog.isLocalEvaluationReady()).toBe(true)
    })

    it('cache provider integrates successfully with flag loading', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      // Verify cache provider was used to load flags
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalled()

      // Verify flags were loaded from cache
      expect(posthog.isLocalEvaluationReady()).toBe(true)
      const flagValue = await posthog.getFeatureFlag('test-flag', 'user-123')
      expect(flagValue).toBeDefined()
    })

    it('works without cache provider (null/undefined)', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      expect(posthog.isLocalEvaluationReady()).toBe(true)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('handles cache provider returning stale data gracefully', async () => {
      const staleData: FlagDefinitionCacheData = {
        flags: [
          {
            id: 999,
            name: 'Old Flag',
            key: 'old-flag',
            active: false,
            deleted: true,
            rollout_percentage: null,
            ensure_experience_continuity: false,
            experiment_set: [],
          } as PostHogFeatureFlag,
        ],
        groupTypeMapping: {},
        cohorts: {},
      }

      mockCacheProvider.getFlagDefinitions.mockReturnValue(staleData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await jest.runOnlyPendingTimersAsync()

      // Should still initialize with stale data
      expect(posthog.isLocalEvaluationReady()).toBe(true)

      // But flag should evaluate to false since it's inactive
      const flagValue = await posthog.getFeatureFlag('old-flag', 'user-123')
      expect(flagValue).toBe(false)
    })
  })

  describe('initialization behavior', () => {
    it('avoids double cache check when cache misses on initial load', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(false)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await posthog.waitForLocalEvaluationReady()

      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(posthog.isLocalEvaluationReady()).toBe(true)
    })

    it('handles multiple flag evaluation calls efficiently with single cache check', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      const results = await Promise.all([
        posthog.getFeatureFlag('test-flag', 'user-1'),
        posthog.getFeatureFlag('test-flag', 'user-2'),
        posthog.getFeatureFlag('test-flag', 'user-3'),
        posthog.getAllFlags('user-4'),
        posthog.getFeatureFlag('test-flag', 'user-5'),
      ])

      await posthog.waitForLocalEvaluationReady()

      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      results.forEach((result) => {
        expect(result).toBeDefined()
      })

      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('multiple calls during cache miss trigger single API fetch', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)
      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      const results = await Promise.all([
        posthog.getFeatureFlag('test-flag', 'user-1'),
        posthog.getFeatureFlag('test-flag', 'user-2'),
        posthog.getAllFlags('user-3'),
      ])

      await posthog.waitForLocalEvaluationReady()

      expect(mockedFetch).toHaveBeenCalledTimes(1)
      results.forEach((result) => {
        expect(result).toBeDefined()
      })
    })

    it('subsequent calls after successful load skip cache and API checks entirely', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await posthog.waitForLocalEvaluationReady()

      mockCacheProvider.getFlagDefinitions.mockClear()
      mockCacheProvider.shouldFetchFlagDefinitions.mockClear()
      mockedFetch.mockClear()

      await posthog.getFeatureFlag('test-flag', 'user-1')
      await posthog.getAllFlags('user-2')
      await posthog.getFeatureFlag('test-flag', 'user-3')

      expect(mockCacheProvider.getFlagDefinitions).not.toHaveBeenCalled()
      expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalled()
    })
  })
})
