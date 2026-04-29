import { _resetDeprecationWarningsForTests } from '@/client'
import { PostHog } from '@/entrypoints/index.node'
import { FeatureFlagEvaluations } from '@/feature-flag-evaluations'
import { EventMessage, PostHogOptions } from '@/types'
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
  let captures: any[] = []

  // Per-test setup helper. The vast majority of tests want the same defaults; tests with
  // custom options (`featureFlagsLogWarnings: false`, `personalApiKey: ...`) call this
  // explicitly with overrides so the deviation stands out.
  const setup = (overrides: Partial<PostHogOptions> = {}): PostHog => {
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      ...posthogImmediateResolveOptions,
      ...overrides,
    })
    captures = []
    posthog.on('capture', (message) => captures.push(message))
    return posthog
  }

  afterEach(async () => {
    await posthog.shutdown()
  })

  describe('remote evaluation', () => {
    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))
      setup()
    })

    it('makes a single /flags call and returns a FeatureFlagEvaluations instance', async () => {
      const flags = await posthog.evaluateFlags('user-1')

      expect(flags).toBeInstanceOf(FeatureFlagEvaluations)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
      const [url] = mockedFetch.mock.calls[0]
      expect(url).toMatch(/\/flags\/\?v=2(?:&|$)/)
    })

    it('does not fire $feature_flag_called events for flags that are not accessed', async () => {
      await posthog.evaluateFlags('user-1')
      await waitForPromises()

      const flagCalled = captures.filter((m) => m.event === '$feature_flag_called')
      expect(flagCalled).toHaveLength(0)
    })

    it('isEnabled returns true/false and fires $feature_flag_called on first access', async () => {
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
      const flags = await posthog.evaluateFlags('user-1')
      expect(flags.getFlagPayload('variant-flag')).toEqual({ key: 'value' })
      expect(flags.getFlagPayload('missing-flag')).toBeUndefined()

      await waitForPromises()
      expect(captures.filter((m) => m.event === '$feature_flag_called')).toHaveLength(0)
    })

    it('uses distinctId from context when not passed explicitly', async () => {
      const flags = await posthog.withContext({ distinctId: 'context-user' }, () => posthog.evaluateFlags())

      expect(flags).toBeInstanceOf(FeatureFlagEvaluations)
      expect(flags.keys.sort()).toEqual(['boolean-flag', 'disabled-flag', 'variant-flag'])
    })

    it('forwards flagKeys to the /flags request to scope the evaluation', async () => {
      await posthog.evaluateFlags('user-1', { flagKeys: ['boolean-flag', 'variant-flag'] })

      expect(mockedFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockedFetch.mock.calls[0]
      const body = JSON.parse((init as any).body as string)
      expect(body.flag_keys_to_evaluate).toEqual(['boolean-flag', 'variant-flag'])
    })

    it('returns an empty snapshot when no distinctId is available', async () => {
      const flags = await posthog.evaluateFlags()

      expect(flags.keys).toEqual([])
    })

    it('does not fire $feature_flag_called events from an empty-distinctId snapshot', async () => {
      const flags = await posthog.evaluateFlags()
      flags.isEnabled('any-flag')
      flags.getFlag('any-flag')

      await waitForPromises()
      expect(captures.filter((m) => m.event === '$feature_flag_called')).toHaveLength(0)
    })
  })

  describe('filtering helpers', () => {
    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))
      setup()
    })

    it('onlyAccessed returns a snapshot with only accessed flags', async () => {
      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag')
      flags.getFlag('variant-flag')

      const accessed = flags.onlyAccessed()
      expect(accessed.keys.sort()).toEqual(['boolean-flag', 'variant-flag'])
    })

    it('onlyAccessed returns empty when no flags accessed', async () => {
      // The method honors its name: nothing accessed → empty snapshot, no fallback.
      const flags = await posthog.evaluateFlags('user-1')
      const accessed = flags.onlyAccessed()

      expect(accessed.keys).toEqual([])
    })

    it('featureFlagsLogWarnings=false silences filter warnings', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      setup({ featureFlagsLogWarnings: false })

      const flags = await posthog.evaluateFlags('user-1')
      flags.onlyAccessed()
      flags.only(['does-not-exist'])

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('FeatureFlagEvaluations'))
      warnSpy.mockRestore()
    })

    it('only returns a filtered snapshot and warns about missing keys', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      const flags = await posthog.evaluateFlags('user-1')
      const only = flags.only(['boolean-flag', 'does-not-exist'])

      expect(only.keys).toEqual(['boolean-flag'])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('does-not-exist'))
      warnSpy.mockRestore()
    })

    it('filtered snapshots do not back-propagate access to the parent', async () => {
      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag')
      const filtered = flags.onlyAccessed()

      filtered.isEnabled('variant-flag')

      expect(flags.onlyAccessed().keys).toEqual(['boolean-flag'])
    })

    it('branching on a key excluded from a slice is a no-op (no flag_missing event)', async () => {
      // Filtered snapshots are intended for `capture()`. Calling `isEnabled()` on a slice
      // for a key that was filtered out should not fire `$feature_flag_called` with
      // `$feature_flag_error: flag_missing` — the flag wasn't missing, just sliced away.
      const flags = await posthog.evaluateFlags('user-1')
      const filtered = flags.only(['boolean-flag'])

      expect(filtered.isEnabled('variant-flag')).toBe(false)

      await waitForPromises()
      const flagMissing = captures.filter(
        (m) =>
          m.event === '$feature_flag_called' &&
          m.properties.$feature_flag === 'variant-flag' &&
          m.properties.$feature_flag_error === 'flag_missing'
      )
      expect(flagMissing).toHaveLength(0)
    })
  })

  describe('capture integration', () => {
    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))
      setup()
    })

    it('capture({ flags }) attaches $feature/* and $active_feature_flags from the snapshot', async () => {
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

    it('flags option takes precedence over sendFeatureFlags and warns when both passed', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
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
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Both `flags` and `sendFeatureFlags` were passed to capture()')
      )
      warnSpy.mockRestore()
    })

    it('captureException forwards flags through to the $exception event', async () => {
      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag')

      posthog.captureException(new Error('boom'), 'user-1', undefined, undefined, flags.onlyAccessed())

      // captureException → addPendingPromise(buildEventMessage().then(msg => capture(...)))
      // → capture itself queues async work via prepareEventMessage. The 'capture' event
      // fires inside captureStateless before the network flush, so we just need enough
      // microtask cycles to let the chain resolve.
      await waitForPromises()
      await waitForPromises()
      await waitForPromises()

      const exception = captures.find((m) => m.event === '$exception')
      expect(exception).toBeDefined()
      expect(exception.properties).toMatchObject({
        '$feature/boolean-flag': true,
        $active_feature_flags: ['boolean-flag'],
      })
      expect(exception.properties['$feature/variant-flag']).toBeUndefined()
    })

    it('captureExceptionImmediate forwards the flags snapshot to captureImmediate', async () => {
      // captureStatelessImmediate doesn't fire the EventEmitter 'capture' event (it sends
      // directly), so we verify forwarding by spying on captureImmediate itself.
      const flags = await posthog.evaluateFlags('user-1')
      const filtered = flags.only(['boolean-flag'])
      const spy = jest.spyOn(posthog, 'captureImmediate').mockResolvedValue(undefined)

      await posthog.captureExceptionImmediate(new Error('boom'), 'user-1', undefined, filtered)
      await waitForPromises()

      expect(spy).toHaveBeenCalledTimes(1)
      const arg = spy.mock.calls[0][0] as EventMessage
      expect(arg.flags).toBe(filtered)
      expect(arg.event).toBe('$exception')

      spy.mockRestore()
    })
  })

  describe('error granularity', () => {
    beforeEach(() => {
      setup()
    })

    it('combines response-level errors_while_computing with per-flag flag_missing', async () => {
      const response = flagsResponseFixture()
      response.errorsWhileComputingFlags = true
      mockedFetch.mockImplementation(apiImplementationV4(response))

      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag') // known flag — only response-level error
      flags.isEnabled('missing-flag') // missing — both errors combined

      await waitForPromises()
      const byKey = Object.fromEntries(
        captures
          .filter((m) => m.event === '$feature_flag_called')
          .map((m) => [m.properties.$feature_flag, m.properties])
      )
      expect(byKey['boolean-flag'].$feature_flag_error).toEqual('errors_while_computing_flags')
      expect(byKey['missing-flag'].$feature_flag_error).toEqual('errors_while_computing_flags,flag_missing')
    })

    it('reports quota_limited from response.quotaLimited', async () => {
      const response = flagsResponseFixture()
      ;(response as any).quotaLimited = ['feature_flags']
      mockedFetch.mockImplementation(apiImplementationV4(response))

      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('boolean-flag')

      await waitForPromises()
      const flagCalled = captures.find((m) => m.event === '$feature_flag_called')
      // Quota-limited responses strip flag data; the access becomes a missing-flag lookup
      // against the empty snapshot, so the combined error string surfaces both.
      expect(flagCalled.properties.$feature_flag_error).toEqual('quota_limited,flag_missing')
    })
  })

  describe('deprecation warnings', () => {
    beforeEach(() => {
      _resetDeprecationWarningsForTests()
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))
      setup()
    })

    it('getFeatureFlag emits a deprecation warning pointing at evaluateFlags', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      await posthog.getFeatureFlag('boolean-flag', 'user-1')

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('`getFeatureFlag` is deprecated'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('evaluateFlags'))
      warnSpy.mockRestore()
    })

    it('isFeatureEnabled emits exactly one deprecation warning per call (no cascade)', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      await posthog.isFeatureEnabled('boolean-flag', 'user-1')

      const deprecation = warnSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && /is deprecated/.test(call[0])
      )
      expect(deprecation).toHaveLength(1)
      expect(deprecation[0][0]).toEqual(expect.stringContaining('`isFeatureEnabled` is deprecated'))
      warnSpy.mockRestore()
    })

    it('getFeatureFlagPayload emits a deprecation warning', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      await posthog.getFeatureFlagPayload('variant-flag', 'user-1')

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('`getFeatureFlagPayload` is deprecated'))
      warnSpy.mockRestore()
    })

    it('capture(sendFeatureFlags: true) emits a deprecation warning', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      posthog.capture({ distinctId: 'user-1', event: 'page_viewed', sendFeatureFlags: true })
      await posthog.flush()

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('`sendFeatureFlags` is deprecated'))
      warnSpy.mockRestore()
    })

    it('dedupes deprecation warnings across repeated calls', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      await posthog.getFeatureFlag('boolean-flag', 'user-1')
      await posthog.getFeatureFlag('variant-flag', 'user-2')
      await posthog.getFeatureFlag('disabled-flag', 'user-3')

      const deprecation = warnSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && /`getFeatureFlag` is deprecated/.test(call[0])
      )
      expect(deprecation).toHaveLength(1)
      warnSpy.mockRestore()
    })
  })

  describe('local evaluation', () => {
    const localFlagsFixture = () => ({
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
    })

    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: localFlagsFixture() }))
      setup({ personalApiKey: 'TEST_PERSONAL_API_KEY' })
    })

    it('evaluates flags locally and tags events with locally_evaluated=true', async () => {
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

    it('attaches $feature_flag_definitions_loaded_at on locally-evaluated $feature_flag_called events', async () => {
      const flags = await posthog.evaluateFlags('user-1')
      flags.isEnabled('local-flag')

      await waitForPromises()
      const flagCalled = captures.find((m) => m.event === '$feature_flag_called')
      expect(flagCalled.properties.$feature_flag_definitions_loaded_at).toEqual(expect.any(Number))
    })
  })

  describe('overrides', () => {
    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponseFixture()))
      setup()
    })

    it('applies flag and payload overrides to the snapshot', async () => {
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
