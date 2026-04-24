import { PostHog } from '@/entrypoints/index.node'
import { FeatureFlagEvaluations } from '@/feature-flag-evaluations'
import { PostHogOptions } from '@/types'
import { apiImplementation, apiImplementationV4, waitForPromises } from './utils'
import { PostHogV2FlagsResponse } from '@posthog/core'

jest.spyOn(console, 'debug').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const posthogImmediateResolveOptions: PostHogOptions = {
  fetchRetryCount: 0,
}

const flagsResponseFixture = (): PostHogV2FlagsResponse => ({
  flags: {
    'variant-flag': {
      key: 'variant-flag',
      enabled: true,
      variant: 'variant-value',
      reason: {
        code: 'variant',
        condition_index: 2,
        description: 'Matched condition set 3',
      },
      metadata: {
        id: 2,
        version: 23,
        payload: '{"key": "value"}',
        description: 'description',
      },
    },
    'boolean-flag': {
      key: 'boolean-flag',
      enabled: true,
      variant: undefined,
      reason: {
        code: 'boolean',
        condition_index: 1,
        description: 'Matched condition set 1',
      },
      metadata: {
        id: 1,
        version: 12,
        payload: undefined,
        description: 'description',
      },
    },
    'disabled-flag': {
      key: 'disabled-flag',
      enabled: false,
      variant: undefined,
      reason: {
        code: 'boolean',
        condition_index: 1,
        description: 'Did not match any condition',
      },
      metadata: {
        id: 3,
        version: 2,
        payload: undefined,
        description: 'description',
      },
    },
  },
  errorsWhileComputingFlags: false,
  requestId: 'request-id-1',
  evaluatedAt: 1640995200000,
})

describe('evaluateFlags', () => {
  let posthog: PostHog

  afterEach(async () => {
    await posthog.shutdown()
  })

  describe('remote evaluation', () => {
    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))
    })

    it('makes a single /flags call and returns a FeatureFlagEvaluations instance', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.evaluateFlags('user-1')

      expect(flags).toBeInstanceOf(FeatureFlagEvaluations)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      const [url] = mockedFetch.mock.calls[0]
      expect(url).toMatch(/\/flags\/\?v=2(?:&|$)/)
    })

    it('does not fire $feature_flag_called events for flags that are not accessed', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      await posthog.evaluateFlags('user-1')
      await waitForPromises()

      const flagCalled = captures.filter((m) => m.event === '$feature_flag_called')
      expect(flagCalled).toHaveLength(0)
    })

    it('isEnabled returns true/false and fires $feature_flag_called on first access', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      const flags = await posthog.evaluateFlags('user-1')

      expect(flags.isEnabled('boolean-flag')).toBe(true)
      expect(flags.isEnabled('disabled-flag')).toBe(false)
      expect(flags.isEnabled('variant-flag')).toBe(true)

      await waitForPromises()
      const flagCalled = captures.filter((m) => m.event === '$feature_flag_called')
      expect(flagCalled).toHaveLength(3)
      expect(flagCalled.map((m) => m.properties.$feature_flag).sort()).toEqual([
        'boolean-flag',
        'disabled-flag',
        'variant-flag',
      ])
    })

    it('getFlag returns variant/true/false/undefined and carries full metadata', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      const flags = await posthog.evaluateFlags('user-1')

      expect(flags.getFlag('variant-flag')).toBe('variant-value')
      expect(flags.getFlag('boolean-flag')).toBe(true)
      expect(flags.getFlag('disabled-flag')).toBe(false)
      expect(flags.getFlag('missing-flag')).toBeUndefined()

      await waitForPromises()
      const byKey = Object.fromEntries(
        captures
          .filter((m) => m.event === '$feature_flag_called')
          .map((m) => [m.properties.$feature_flag, m.properties])
      )
      expect(byKey['variant-flag']).toMatchObject({
        $feature_flag: 'variant-flag',
        $feature_flag_response: 'variant-value',
        $feature_flag_id: 2,
        $feature_flag_version: 23,
        $feature_flag_reason: 'Matched condition set 3',
        $feature_flag_request_id: 'request-id-1',
        locally_evaluated: false,
      })
      expect(byKey['missing-flag']).toMatchObject({
        $feature_flag: 'missing-flag',
        $feature_flag_response: undefined,
        $feature_flag_error: 'flag_missing',
        locally_evaluated: false,
      })
    })

    it('dedupes $feature_flag_called events across repeated access for the same distinctId+value', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag')
      flags.isEnabled('boolean-flag')
      flags.getFlag('boolean-flag')

      await waitForPromises()
      const flagCalled = captures.filter(
        (m) => m.event === '$feature_flag_called' && m.properties.$feature_flag === 'boolean-flag'
      )
      expect(flagCalled).toHaveLength(1)
    })

    it('getFlagPayload returns parsed payload without firing an event', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      const flags = await posthog.evaluateFlags('user-1')
      expect(flags.getFlagPayload('variant-flag')).toEqual({ key: 'value' })
      expect(flags.getFlagPayload('missing-flag')).toBeUndefined()

      await waitForPromises()
      expect(captures.filter((m) => m.event === '$feature_flag_called')).toHaveLength(0)
    })

    it('uses distinctId from context when not passed explicitly', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.withContext({ distinctId: 'context-user' }, () => posthog.evaluateFlags())

      expect(flags).toBeInstanceOf(FeatureFlagEvaluations)
      expect(flags.keys.sort()).toEqual(['boolean-flag', 'disabled-flag', 'variant-flag'])
    })

    it('returns an empty snapshot when no distinctId is available', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.evaluateFlags()

      expect(flags.keys).toEqual([])
    })
  })

  describe('filtering helpers', () => {
    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))
    })

    it('onlyAccessed returns a snapshot with only accessed flags', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag')
      flags.getFlag('variant-flag')

      const accessed = flags.onlyAccessed()
      expect(accessed.keys.sort()).toEqual(['boolean-flag', 'variant-flag'])
    })

    it('onlyAccessed warns and falls back to all flags when nothing was accessed', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.evaluateFlags('user-1')
      const accessed = flags.onlyAccessed()

      expect(accessed.keys.sort()).toEqual(['boolean-flag', 'disabled-flag', 'variant-flag'])
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('onlyAccessed() was called before any flags were accessed')
      )
      warnSpy.mockRestore()
    })

    it('featureFlagsLogWarnings=false silences filter warnings', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        featureFlagsLogWarnings: false,
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.evaluateFlags('user-1')
      flags.onlyAccessed()
      flags.only(['does-not-exist'])

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('FeatureFlagEvaluations'))
      warnSpy.mockRestore()
    })

    it('only returns a filtered snapshot and warns about missing keys', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.evaluateFlags('user-1')
      const only = flags.only(['boolean-flag', 'does-not-exist'])

      expect(only.keys).toEqual(['boolean-flag'])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('does-not-exist'))
      warnSpy.mockRestore()
    })

    it('filtered snapshots do not back-propagate access to the parent', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag')
      const filtered = flags.onlyAccessed()

      filtered.isEnabled('variant-flag')

      expect(flags.onlyAccessed().keys).toEqual(['boolean-flag'])
    })
  })

  describe('capture integration', () => {
    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))
    })

    it('capture({ flags }) attaches $feature/* and $active_feature_flags from the snapshot', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      const flags = await posthog.evaluateFlags('user-1')
      posthog.capture({ distinctId: 'user-1', event: 'page_viewed', flags })
      await waitForPromises()

      const pageViewed = captures.find((m) => m.event === 'page_viewed')
      expect(pageViewed).toBeDefined()
      expect(pageViewed.properties).toMatchObject({
        '$feature/variant-flag': 'variant-value',
        '$feature/boolean-flag': true,
        '$feature/disabled-flag': false,
        $active_feature_flags: ['boolean-flag', 'variant-flag'],
      })
    })

    it('capture({ flags: flags.onlyAccessed() }) only attaches accessed flags', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag')
      posthog.capture({ distinctId: 'user-1', event: 'page_viewed', flags: flags.onlyAccessed() })
      await waitForPromises()

      const pageViewed = captures.find((m) => m.event === 'page_viewed')
      expect(pageViewed.properties).toMatchObject({
        '$feature/boolean-flag': true,
        $active_feature_flags: ['boolean-flag'],
      })
      expect(pageViewed.properties['$feature/variant-flag']).toBeUndefined()
      expect(pageViewed.properties['$feature/disabled-flag']).toBeUndefined()
    })

    it('does not trigger an additional /flags request on capture', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const flags = await posthog.evaluateFlags('user-1')
      const callsAfterEvaluate = mockedFetch.mock.calls.length

      posthog.capture({ distinctId: 'user-1', event: 'page_viewed', flags })
      await posthog.flush()

      const flagCallsAfterCapture = mockedFetch.mock.calls.filter((c) =>
        (c[0] as string).includes('/flags/?v=2')
      ).length
      const flagCallsBeforeCapture = mockedFetch.mock.calls
        .slice(0, callsAfterEvaluate)
        .filter((c) => (c[0] as string).includes('/flags/?v=2')).length
      expect(flagCallsAfterCapture).toEqual(flagCallsBeforeCapture)
    })

    it('flags option takes precedence over sendFeatureFlags', async () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      const flags = await posthog.evaluateFlags('user-1')
      const callsBefore = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/flags/?v=2')).length

      posthog.capture({
        distinctId: 'user-1',
        event: 'page_viewed',
        flags: flags.only(['boolean-flag']),
        sendFeatureFlags: true,
      })
      await posthog.flush()

      const callsAfter = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/flags/?v=2')).length
      expect(callsAfter).toEqual(callsBefore)

      const pageViewed = captures.find((m) => m.event === 'page_viewed')
      expect(pageViewed.properties).toMatchObject({
        '$feature/boolean-flag': true,
        $active_feature_flags: ['boolean-flag'],
      })
      expect(pageViewed.properties['$feature/variant-flag']).toBeUndefined()
    })
  })

  describe('local evaluation', () => {
    it('evaluates flags locally and tags events with locally_evaluated=true', async () => {
      const localFlags = {
        flags: [
          {
            id: 42,
            name: 'Always on',
            key: 'local-flag',
            active: true,
            filters: {
              groups: [{ variant: null, properties: [], rollout_percentage: 100 }],
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags }))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })
      const captures: any[] = []
      posthog.on('capture', (message) => captures.push(message))

      const flags = await posthog.evaluateFlags('user-1')
      expect(flags.isEnabled('local-flag')).toBe(true)

      await waitForPromises()
      const flagCalled = captures.find((m) => m.event === '$feature_flag_called')
      expect(flagCalled).toBeDefined()
      expect(flagCalled.properties).toMatchObject({
        $feature_flag: 'local-flag',
        $feature_flag_id: 42,
        $feature_flag_reason: 'Evaluated locally',
        locally_evaluated: true,
      })

      // No remote /flags request since local evaluation covered it.
      const remoteFlagCalls = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/flags/?v=2'))
      expect(remoteFlagCalls).toHaveLength(0)
    })
  })

  describe('overrides', () => {
    it('applies flag and payload overrides to the snapshot', async () => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      posthog.overrideFeatureFlags({
        flags: { 'boolean-flag': false, 'new-flag': 'variant-a' },
        payloads: { 'variant-flag': { overridden: true } },
      })

      const flags = await posthog.evaluateFlags('user-1')
      expect(flags.isEnabled('boolean-flag')).toBe(false)
      expect(flags.getFlag('new-flag')).toBe('variant-a')
      expect(flags.getFlagPayload('variant-flag')).toEqual({ overridden: true })
    })
  })
})
