import { PostHog } from '@/entrypoints/index.node'
import { PostHogOptions } from '@/types'
import { anyFlagsCall, anyLocalEvalCall, apiImplementation, apiImplementationV4, waitForPromises } from './utils'
import { PostHogV2FlagsResponse } from '@posthog/core'

jest.spyOn(console, 'debug').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const posthogImmediateResolveOptions: PostHogOptions = {
  fetchRetryCount: 0,
}

describe('getFeatureFlags', () => {
  let posthog: PostHog

  afterEach(async () => {
    await posthog.shutdown()
  })

  describe('remote evaluation', () => {
    const flagsResponse: PostHogV2FlagsResponse = {
      flags: {
        'flag-one': {
          key: 'flag-one',
          enabled: true,
          variant: 'variant-a',
          reason: { code: 'matched', condition_index: 0, description: 'Matched condition set 1' },
          metadata: { id: 11, version: 3, payload: '{"feature":"a"}', description: undefined },
        },
        'flag-two': {
          key: 'flag-two',
          enabled: false,
          variant: undefined,
          reason: { code: 'no_match', condition_index: undefined, description: 'Did not match any condition' },
          metadata: { id: 22, version: 7, payload: undefined, description: undefined },
        },
      },
      errorsWhileComputingFlags: false,
      requestId: 'req-bulk-1',
      evaluatedAt: 1700000000000,
    }

    beforeEach(() => {
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
    })

    it('returns rich FeatureFlagResult for each requested key from a single remote call', async () => {
      const results = await posthog.getFeatureFlags(['flag-one', 'flag-two'], 'user-1', {
        sendFeatureFlagEvents: false,
      })

      expect(results['flag-one']).toEqual({
        key: 'flag-one',
        enabled: true,
        variant: 'variant-a',
        payload: { feature: 'a' },
      })
      expect(results['flag-two']).toEqual({
        key: 'flag-two',
        enabled: false,
        variant: undefined,
        payload: undefined,
      })

      const flagsCalls = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/flags/'))
      expect(flagsCalls).toHaveLength(1)
    })

    it('emits $feature_flag_called per resolved flag with metadata parity to getFeatureFlag', async () => {
      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      await posthog.getFeatureFlags(['flag-one', 'flag-two'], 'user-1')
      await waitForPromises()

      const events = captured.filter((m) => m.event === '$feature_flag_called')
      expect(events).toHaveLength(2)

      const byKey = Object.fromEntries(events.map((e) => [e.properties.$feature_flag, e]))
      expect(byKey['flag-one'].properties).toMatchObject({
        $feature_flag: 'flag-one',
        $feature_flag_response: 'variant-a',
        $feature_flag_id: 11,
        $feature_flag_version: 3,
        $feature_flag_reason: 'Matched condition set 1',
        $feature_flag_request_id: 'req-bulk-1',
        $feature_flag_evaluated_at: 1700000000000,
        locally_evaluated: false,
        '$feature/flag-one': 'variant-a',
      })
      expect(byKey['flag-two'].properties).toMatchObject({
        $feature_flag: 'flag-two',
        $feature_flag_response: false,
        $feature_flag_id: 22,
        $feature_flag_version: 7,
        $feature_flag_reason: 'Did not match any condition',
        $feature_flag_request_id: 'req-bulk-1',
        locally_evaluated: false,
        '$feature/flag-two': false,
      })
    })

    it('dedupes events across calls using the existing distinctIdHasSentFlagCalls cache', async () => {
      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      await posthog.getFeatureFlags(['flag-one'], 'user-1')
      await posthog.getFeatureFlags(['flag-one'], 'user-1')
      await waitForPromises()

      const events = captured.filter((m) => m.event === '$feature_flag_called')
      expect(events).toHaveLength(1)
    })

    it('does not emit events when sendFeatureFlagEvents is false', async () => {
      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      await posthog.getFeatureFlags(['flag-one'], 'user-1', { sendFeatureFlagEvents: false })
      await waitForPromises()

      expect(captured.filter((m) => m.event === '$feature_flag_called')).toHaveLength(0)
    })

    it('emits an event with response=undefined when a requested key is missing from the response', async () => {
      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      await posthog.getFeatureFlags(['flag-one', 'unknown-flag'], 'user-1')
      await waitForPromises()

      const events = captured.filter((m) => m.event === '$feature_flag_called')
      const unknown = events.find((e) => e.properties.$feature_flag === 'unknown-flag')
      expect(unknown).toBeDefined()
      expect(unknown!.properties.$feature_flag_response).toBeUndefined()
      expect(unknown!.properties.$feature_flag_error).toContain('flag_missing')
    })
  })

  describe('onlyEvaluateLocally', () => {
    it('returns undefined for unresolved keys without hitting the network and still emits events', async () => {
      mockedFetch.mockImplementation(apiImplementation({ localFlags: { flags: [] } }))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      const results = await posthog.getFeatureFlags(['missing-flag'], 'user-1', { onlyEvaluateLocally: true })
      expect(results['missing-flag']).toBeUndefined()
      await waitForPromises()

      const flagsCalls = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/flags/?v=2'))
      expect(flagsCalls).toHaveLength(0)

      const events = captured.filter((m) => m.event === '$feature_flag_called')
      expect(events).toHaveLength(1)
      expect(events[0].properties).toMatchObject({
        $feature_flag: 'missing-flag',
        $feature_flag_response: undefined,
        locally_evaluated: false,
      })
    })
  })

  describe('local + remote hybrid', () => {
    it('resolves some keys locally, falls back once for the rest, and emits events for both', async () => {
      const localFlags = {
        flags: [
          {
            id: 42,
            name: 'Local Flag',
            key: 'local-flag',
            active: true,
            filters: {
              groups: [{ properties: [], rollout_percentage: 100 }],
            },
          },
        ],
      }
      mockedFetch.mockImplementation(
        apiImplementation({
          localFlags,
          decideFlags: { 'remote-flag': true },
        })
      )

      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      const results = await posthog.getFeatureFlags(['local-flag', 'remote-flag'], 'user-1')
      await waitForPromises()

      expect(results['local-flag']?.enabled).toBe(true)
      expect(results['remote-flag']?.enabled).toBe(true)

      // Exactly one remote /flags call happened, and it requested only the unresolved key.
      const flagsCalls = mockedFetch.mock.calls.filter((c) => (c[0] as string).includes('/flags/?v=2'))
      expect(flagsCalls).toHaveLength(1)
      const requestBody = JSON.parse((flagsCalls[0][1] as any).body)
      expect(requestBody.flag_keys_to_evaluate).toEqual(['remote-flag'])

      const events = captured.filter((m) => m.event === '$feature_flag_called')
      expect(events).toHaveLength(2)
      const local = events.find((e) => e.properties.$feature_flag === 'local-flag')!
      const remote = events.find((e) => e.properties.$feature_flag === 'remote-flag')!
      expect(local.properties.locally_evaluated).toBe(true)
      expect(local.properties.$feature_flag_id).toBe(42)
      expect(remote.properties.locally_evaluated).toBe(false)
    })
  })

  describe('getAllFlags sendFeatureFlagEvents option', () => {
    it('emits $feature_flag_called per flag when explicitly enabled on the bulk method', async () => {
      const flagsResponse: PostHogV2FlagsResponse = {
        flags: {
          'bulk-a': {
            key: 'bulk-a',
            enabled: true,
            variant: undefined,
            reason: { code: 'matched', condition_index: 0, description: 'Matched' },
            metadata: { id: 1, version: 1, payload: undefined, description: undefined },
          },
          'bulk-b': {
            key: 'bulk-b',
            enabled: true,
            variant: 'b-variant',
            reason: { code: 'matched', condition_index: 0, description: 'Matched' },
            metadata: { id: 2, version: 1, payload: undefined, description: undefined },
          },
        },
        errorsWhileComputingFlags: false,
        requestId: 'req-all',
        evaluatedAt: 1700000000000,
      }
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      const all = await posthog.getAllFlags('user-1', { sendFeatureFlagEvents: true })
      await waitForPromises()

      expect(all).toEqual({ 'bulk-a': true, 'bulk-b': 'b-variant' })
      const events = captured.filter((m) => m.event === '$feature_flag_called')
      expect(events).toHaveLength(2)
      expect(events.map((e) => e.properties.$feature_flag).sort()).toEqual(['bulk-a', 'bulk-b'])
    })

    it('does not emit events by default, preserving existing behavior', async () => {
      const flagsResponse: PostHogV2FlagsResponse = {
        flags: {
          'bulk-a': {
            key: 'bulk-a',
            enabled: true,
            variant: undefined,
            reason: { code: 'matched', condition_index: 0, description: 'Matched' },
            metadata: { id: 1, version: 1, payload: undefined, description: undefined },
          },
        },
        errorsWhileComputingFlags: false,
        requestId: 'req-all-no-events',
      }
      mockedFetch.mockImplementation(apiImplementationV4(flagsResponse))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })

      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      await posthog.getAllFlags('user-1')
      await waitForPromises()

      expect(captured.filter((m) => m.event === '$feature_flag_called')).toHaveLength(0)
    })
  })

  describe('overrides', () => {
    it('honors flag overrides without emitting events for overridden flags', async () => {
      mockedFetch.mockImplementation(apiImplementation({ decideFlags: {} }))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      posthog.overrideFeatureFlags({ 'overridden-flag': 'forced-variant' })

      const captured: any[] = []
      posthog.on('capture', (msg) => captured.push(msg))

      const results = await posthog.getFeatureFlags(['overridden-flag'], 'user-1')
      await waitForPromises()

      expect(results['overridden-flag']).toEqual({
        key: 'overridden-flag',
        enabled: true,
        variant: 'forced-variant',
        payload: undefined,
      })
      expect(captured.filter((m) => m.event === '$feature_flag_called')).toHaveLength(0)
    })
  })
})

// Suppress unused import warning when apiImplementation is unused in a describe block variant
void anyFlagsCall
void anyLocalEvalCall
