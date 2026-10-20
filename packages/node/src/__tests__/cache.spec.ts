import { FlagDefinitionCacheProvider, FlagDefinitionCacheData } from '../extensions/feature-flags/cache'
import { PostHogFeatureFlag, PostHogOptions } from '../types'
import { PostHog } from '../entrypoints/index.node'
import { anyLocalEvalCall, apiImplementation } from './utils'

vi.spyOn(console, 'debug').mockImplementation()
vi.spyOn(console, 'warn').mockImplementation()

const mockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation()

describe('FlagDefinitionCacheProvider Integration', () => {
  let posthog: PostHog
  let mockCacheProvider: vi.Mocked<FlagDefinitionCacheProvider>
  let onErrorMock: vi.Mock

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
    minimalFlagCalledEvents: false,
  }

  const publishedFlagData = {
    ...testFlagData,
    group_type_mapping: testFlagData.groupTypeMapping,
    minimal_flag_called_events: false,
  }

  vi.useFakeTimers()

  beforeEach(() => {
    mockedFetch.mockClear()
    onErrorMock = vi.fn()
    mockCacheProvider = {
      getFlagDefinitions: vi.fn(),
      shouldFetchFlagDefinitions: vi.fn(),
      onFlagDefinitionsReceived: vi.fn(),
      shutdown: vi.fn(),
    }
  })

  afterEach(async () => {
    if (posthog) {
      await posthog.shutdown()
    }
  })

  describe('Provider-only local evaluation', () => {
    const cachedDefinitions: FlagDefinitionCacheData = {
      ...testFlagData,
      flags: [{ ...testFlagData.flags[0], filters: { groups: [{}] } }],
      property_matching_version: 2,
    }

    const createConsumer = (options: PostHogOptions = {}): void => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        flagDefinitionCacheProvider: mockCacheProvider,
        featureFlagsPollingInterval: null,
        fetchRetryCount: 0,
        before_send: () => null,
        ...options,
      })
      posthog.on('error', onErrorMock)
    }

    it.each(['sync', 'async'])('evaluates locally on the first call with a %s provider', async (mode) => {
      if (mode === 'sync') {
        mockCacheProvider.shouldFetchFlagDefinitions.mockReturnValue(false)
        mockCacheProvider.getFlagDefinitions.mockReturnValue(cachedDefinitions)
      } else {
        mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
        mockCacheProvider.getFlagDefinitions.mockResolvedValue(cachedDefinitions)
      }
      createConsumer()
      const onLoad = vi.fn()
      posthog.on('localEvaluationFlagsLoaded', onLoad)

      const flags = await posthog.evaluateFlags('user')

      expect(flags.getFlag('test-flag')).toBe(true)
      expect(posthog.isLocalEvaluationReady()).toBe(true)
      expect(onLoad).toHaveBeenCalledWith(1)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(mockCacheProvider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it.each(['true', 'throw', 'hang'])(
      'reads the cache without invoking a decision that would %s',
      async (decision) => {
        mockCacheProvider.shouldFetchFlagDefinitions.mockImplementation(() => {
          if (decision === 'throw') {
            throw new Error('Coordination failed')
          }
          return decision === 'hang' ? new Promise<boolean>(() => {}) : true
        })
        mockCacheProvider.getFlagDefinitions.mockReturnValue(cachedDefinitions)
        createConsumer({ featureFlagsPollingInterval: 1000 })

        expect(await posthog.waitForLocalEvaluationReady()).toBe(true)
        await vi.advanceTimersByTimeAsync(1000)
        await posthog.reloadFeatureFlags()

        expect((await posthog.evaluateFlags('user')).getFlag('test-flag')).toBe(true)
        expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(3)
        expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
        expect(mockCacheProvider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
        expect(mockedFetch).not.toHaveBeenCalled()
        expect(onErrorMock).not.toHaveBeenCalled()
      }
    )

    it.each([{ secretKey: '  ' }, { personalApiKey: '  ' }, { secretKey: '', personalApiKey: 'TEST_KEY' }])(
      'reads only the cache when the selected credential normalizes to absent: %j',
      async (options) => {
        mockCacheProvider.shouldFetchFlagDefinitions.mockReturnValue(true)
        mockCacheProvider.getFlagDefinitions.mockReturnValue(cachedDefinitions)
        createConsumer(options)

        expect(await posthog.waitForLocalEvaluationReady()).toBe(true)
        expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
        expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
        expect(mockCacheProvider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
        expect(mockedFetch).not.toHaveBeenCalled()
      }
    )

    it('cannot claim shared fetch leadership or block a credentialed publisher from refreshing', async () => {
      let leaseHeld = false
      let sharedDefinitions = cachedDefinitions
      mockCacheProvider.shouldFetchFlagDefinitions.mockImplementation(() => {
        if (leaseHeld) {
          return false
        }
        leaseHeld = true
        return true
      })
      mockCacheProvider.getFlagDefinitions.mockImplementation(() => sharedDefinitions)
      mockCacheProvider.onFlagDefinitionsReceived.mockImplementation((data) => {
        sharedDefinitions = data
        leaseHeld = false
      })
      createConsumer()
      await posthog.reloadFeatureFlags()
      expect(leaseHeld).toBe(false)
      expect(posthog.isLocalEvaluationReady()).toBe(true)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()

      mockedFetch.mockImplementation(apiImplementation({ localFlags: cachedDefinitions }))
      const publisher = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        secretKey: 'TEST_SECRET_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        featureFlagsPollingInterval: 1000,
        fetchRetryCount: 0,
        before_send: () => null,
      })
      try {
        expect(await publisher.waitForLocalEvaluationReady()).toBe(true)
        expect(mockCacheProvider.onFlagDefinitionsReceived).toHaveBeenCalledTimes(1)
        await posthog.reloadFeatureFlags()
        expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(1)
        expect(leaseHeld).toBe(false)

        mockedFetch.mockImplementation(
          apiImplementation({
            localFlags: { ...cachedDefinitions, flags: [{ ...cachedDefinitions.flags[0], active: false }] },
          })
        )
        await vi.advanceTimersByTimeAsync(1000)
        expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(2)
        expect(mockCacheProvider.onFlagDefinitionsReceived).toHaveBeenCalledTimes(2)
        expect(mockedFetch).toHaveBeenCalledTimes(2)

        await posthog.reloadFeatureFlags()
        expect((await posthog.evaluateFlags('user')).getFlag('test-flag')).toBe(false)
        expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(2)
        expect(mockCacheProvider.onFlagDefinitionsReceived).toHaveBeenCalledTimes(2)
        expect(mockedFetch).toHaveBeenCalledTimes(2)
      } finally {
        await publisher.shutdown()
      }
    })

    it('refreshes from the provider on manual reload without automatic polling', async () => {
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
      mockCacheProvider.getFlagDefinitions.mockReturnValue(cachedDefinitions)
      createConsumer()
      expect(await posthog.waitForLocalEvaluationReady()).toBe(true)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)

      mockCacheProvider.getFlagDefinitions.mockReturnValue({
        ...cachedDefinitions,
        flags: [{ ...cachedDefinitions.flags[0], active: false }],
      })
      await posthog.reloadFeatureFlags()

      const flags = await posthog.evaluateFlags('user')
      expect(flags.getFlag('test-flag')).toBe(false)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(2)
      expect(mockCacheProvider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('polls the provider and stops refreshing on shutdown', async () => {
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
      mockCacheProvider.getFlagDefinitions.mockReturnValue(cachedDefinitions)
      createConsumer({ featureFlagsPollingInterval: 1000 })
      expect(await posthog.waitForLocalEvaluationReady()).toBe(true)

      mockCacheProvider.getFlagDefinitions.mockReturnValue({
        ...cachedDefinitions,
        flags: [{ ...cachedDefinitions.flags[0], active: false }],
      })
      await vi.advanceTimersByTimeAsync(1000)

      const flags = await posthog.evaluateFlags('user')
      expect(flags.getFlag('test-flag')).toBe(false)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(2)
      expect(mockCacheProvider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalled()

      await posthog.shutdown()
      expect(mockCacheProvider.shutdown).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(2)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
    })

    describe.each([false, true])('fetch boundary with prior definitions: %s', (alreadyLoaded) => {
      it.each(['empty cache', 'read failure', 'malformed cache'])(
        'does not make a direct request for %s',
        async (scenario) => {
          mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
          mockCacheProvider.getFlagDefinitions.mockReturnValue(alreadyLoaded ? cachedDefinitions : undefined)
          createConsumer()
          await posthog.reloadFeatureFlags()
          mockCacheProvider.shouldFetchFlagDefinitions.mockClear()
          mockCacheProvider.getFlagDefinitions.mockClear()
          onErrorMock.mockClear()

          mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
          if (scenario === 'read failure') {
            mockCacheProvider.getFlagDefinitions.mockRejectedValue(new Error('Cache read failed'))
          } else if (scenario === 'malformed cache') {
            mockCacheProvider.getFlagDefinitions.mockReturnValue({ ...cachedDefinitions, flags: null } as any)
          }

          await expect(posthog.reloadFeatureFlags()).resolves.toBeUndefined()

          expect(posthog.isLocalEvaluationReady()).toBe(alreadyLoaded)
          expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
          expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
          if (scenario === 'read failure') {
            expect(onErrorMock).toHaveBeenCalledWith(
              expect.objectContaining({ message: expect.stringContaining('failed') })
            )
          }
          expect(
            await posthog.getFeatureFlag('test-flag', 'user', {
              onlyEvaluateLocally: true,
              sendFeatureFlagEvents: false,
            })
          ).toBe(alreadyLoaded ? true : undefined)
          expect(mockCacheProvider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
          expect(mockedFetch).not.toHaveBeenCalled()
        }
      )
    })

    it('retries an empty provider on first evaluation and uses definitions once available', async () => {
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
      createConsumer()
      await posthog.reloadFeatureFlags()
      expect(posthog.isLocalEvaluationReady()).toBe(false)

      mockCacheProvider.getFlagDefinitions.mockReturnValue(cachedDefinitions)
      const flags = await posthog.evaluateFlags('user')

      expect(flags.getFlag('test-flag')).toBe(true)
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(2)
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it.each([{ enableLocalEvaluation: false }, { disabled: true }])('respects opt-outs: %j', async (options) => {
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
      mockCacheProvider.getFlagDefinitions.mockReturnValue(cachedDefinitions)
      createConsumer(options)

      await posthog.reloadFeatureFlags()
      expect(await posthog.waitForLocalEvaluationReady()).toBe(false)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
      expect(mockCacheProvider.getFlagDefinitions).not.toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('requires a project token even with a provider', async () => {
      posthog = new PostHog('', { flagDefinitionCacheProvider: mockCacheProvider })

      await posthog.reloadFeatureFlags()
      expect(await posthog.waitForLocalEvaluationReady()).toBe(false)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).not.toHaveBeenCalled()
      expect(mockedFetch).not.toHaveBeenCalled()
    })

    it('does not start definition loading without a credential or provider', async () => {
      posthog = new PostHog('TEST_API_KEY')

      await posthog.reloadFeatureFlags()
      expect(await posthog.waitForLocalEvaluationReady()).toBe(false)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(mockedFetch).not.toHaveBeenCalled()
    })
  })

  describe('Cache Initialization', () => {
    it.each([true, false])(
      'loads initial definitions without polling when the interval is null (cache hit: %s)',
      async (cacheHit) => {
        const flags = [{ ...testFlagData.flags[0], filters: { groups: [{}] } }]
        mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
        mockCacheProvider.getFlagDefinitions.mockReturnValue(cacheHit ? { ...testFlagData, flags } : undefined)
        mockedFetch.mockImplementation(apiImplementation({ localFlags: { ...testFlagDataApiResponse, flags } }))

        posthog = new PostHog('TEST_API_KEY', {
          host: 'http://example.com',
          personalApiKey: 'TEST_PERSONAL_API_KEY',
          flagDefinitionCacheProvider: mockCacheProvider,
          featureFlagsPollingInterval: null,
          fetchRetryCount: 0,
        })

        expect(
          await posthog.getFeatureFlag('test-flag', 'user', {
            onlyEvaluateLocally: true,
            sendFeatureFlagEvents: false,
          })
        ).toBe(true)
        expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(1)
        expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
        if (cacheHit) {
          expect(mockedFetch).not.toHaveBeenCalled()
        } else {
          expect(mockedFetch).toHaveBeenCalledTimes(1)
          expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
        }
        expect(vi.getTimerCount()).toBe(0)

        await vi.advanceTimersByTimeAsync(60_000)

        expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(1)
        expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
        expect(mockedFetch).toHaveBeenCalledTimes(cacheHit ? 0 : 1)
        expect(vi.getTimerCount()).toBe(0)
      }
    )

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
      await vi.runOnlyPendingTimersAsync()

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
      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

      // When shouldFetchFlagDefinitions returns true, we fetch directly without checking cache
      expect(mockCacheProvider.getFlagDefinitions).not.toHaveBeenCalled()
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('emits localEvaluationFlagsLoaded event with correct flag count after loading from cache', async () => {
      const onLoadMock = vi.fn()
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      posthog.on('localEvaluationFlagsLoaded', onLoadMock)

      await vi.runOnlyPendingTimersAsync()

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
      const promises = Array.from({ length: 5 }, () => poller.loadFeatureFlags())

      await Promise.all(promises)

      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(1)
    })
  })

  describe('Fetch Coordination', () => {
    it('calls shouldFetchFlagDefinitions before each poll', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)
      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        featureFlagsPollingInterval: 1000,
        fetchRetryCount: 0,
      })

      await posthog.waitForLocalEvaluationReady()
      mockCacheProvider.shouldFetchFlagDefinitions.mockClear()
      mockedFetch.mockClear()
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      await vi.advanceTimersByTimeAsync(1000)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(mockedFetch).not.toHaveBeenCalled()

      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(true)
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(2)
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
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

      await vi.runOnlyPendingTimersAsync()

      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
      expect(mockCacheProvider.onFlagDefinitionsReceived).toHaveBeenCalledWith(publishedFlagData)
    })

    it('skips fetch and reloads from cache when shouldFetch returns false', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValueOnce(undefined).mockReturnValue({
        ...testFlagData,
        flags: testFlagData.flags.map((flag) => ({
          ...flag,
          filters: { groups: [{ rollout_percentage: 100 }] },
        })),
      })
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
        featureFlagsPollingInterval: 1000,
      })

      await posthog.waitForLocalEvaluationReady()
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      expect(
        await posthog.getFeatureFlag('test-flag', 'user-123', {
          onlyEvaluateLocally: true,
          sendFeatureFlagEvents: false,
        })
      ).toBe(false)
      mockCacheProvider.shouldFetchFlagDefinitions.mockClear()
      mockCacheProvider.getFlagDefinitions.mockClear()
      mockedFetch.mockClear()

      await vi.advanceTimersByTimeAsync(1000)

      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(
        await posthog.getFeatureFlag('test-flag', 'user-123', {
          onlyEvaluateLocally: true,
          sendFeatureFlagEvents: false,
        })
      ).toBe(true)
      expect(mockedFetch).not.toHaveBeenCalled()
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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.onFlagDefinitionsReceived).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('catches getFlagDefinitions errors, logs them, continues initialization', async () => {
      const error = new Error('Cache read failed')
      mockCacheProvider.getFlagDefinitions.mockImplementation(() => {
        throw error
      })
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)

      mockedFetch.mockImplementation(apiImplementation({ localFlags: testFlagDataApiResponse }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      posthog.on('error', onErrorMock)

      await posthog.waitForLocalEvaluationReady()

      expect(mockCacheProvider.getFlagDefinitions).toHaveBeenCalledTimes(1)
      expect(onErrorMock).toHaveBeenCalledWith(new Error('Failed to load from cache: Error: Cache read failed'))
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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()
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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.shouldFetchFlagDefinitions).toHaveBeenCalled()
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('clears the cache shutdown timeout when async shutdown resolves first', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(testFlagData)
      mockCacheProvider.shouldFetchFlagDefinitions.mockResolvedValue(false)
      mockCacheProvider.shutdown.mockResolvedValue(undefined)

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        flagDefinitionCacheProvider: mockCacheProvider,
        fetchRetryCount: 0,
      })

      await vi.runOnlyPendingTimersAsync()
      await posthog.shutdown()

      expect(mockCacheProvider.shutdown).toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
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

      await vi.runOnlyPendingTimersAsync()
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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

      expect(mockCacheProvider.onFlagDefinitionsReceived).toHaveBeenCalledWith(publishedFlagData)
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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

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

      await vi.runOnlyPendingTimersAsync()

      // Should still initialize with stale data
      expect(posthog.isLocalEvaluationReady()).toBe(true)

      // But flag should evaluate to false since it's inactive
      const flagValue = await posthog.getFeatureFlag('old-flag', 'user-123')
      expect(flagValue).toBe(false)
    })
  })

  describe('initialization behavior', () => {
    it('avoids double cache check when cache misses on initial load', async () => {
      mockCacheProvider.getFlagDefinitions.mockReturnValue(undefined)
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
