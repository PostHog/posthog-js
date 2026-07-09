import { ErrorCode, OpenFeature, StandardResolutionReasons, type ResolutionDetails } from '@openfeature/server-sdk'
import type { PostHog } from 'posthog-node'

import { PostHogServerProvider } from '../provider'

type FlagResult = {
  key: string
  enabled: boolean
  variant?: string
  payload?: unknown
}

function makeClient(result: FlagResult | undefined): {
  client: PostHog
  getFeatureFlagResult: jest.Mock
  reloadFeatureFlags: jest.Mock
  on: jest.Mock
  emit: (event: string, ...args: unknown[]) => void
} {
  const getFeatureFlagResult = jest.fn().mockResolvedValue(result)
  const reloadFeatureFlags = jest.fn().mockResolvedValue(undefined)
  // Mirror posthog-node's event emitter: `on` registers a listener and returns
  // an unsubscribe fn; `emit` fans out to registered listeners.
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  const on = jest.fn((event: string, cb: (...args: unknown[]) => void) => {
    ;(listeners[event] ??= []).push(cb)
    return () => {
      listeners[event] = (listeners[event] ?? []).filter((fn) => fn !== cb)
    }
  })
  const emit = (event: string, ...args: unknown[]): void => (listeners[event] ?? []).forEach((fn) => fn(...args))
  return {
    client: { getFeatureFlagResult, reloadFeatureFlags, on } as unknown as PostHog,
    getFeatureFlagResult,
    reloadFeatureFlags,
    on,
    emit,
  }
}

const CTX = { targetingKey: 'user_1' }

type Resolve = (provider: PostHogServerProvider) => Promise<ResolutionDetails<unknown>>

describe('PostHogServerProvider', () => {
  it('identifies as a server provider', () => {
    const { client } = makeClient(undefined)
    const provider = new PostHogServerProvider(client)
    expect(provider.metadata.name).toBe('PostHogServerProvider')
    expect(provider.runsOn).toBe('server')
  })

  describe('resolution', () => {
    it.each<[string, FlagResult, Resolve, Partial<ResolutionDetails<unknown>>]>([
      [
        'boolean enabled → true / TARGETING_MATCH',
        { key: 'flag', enabled: true },
        (p) => p.resolveBooleanEvaluation('flag', false, CTX),
        { value: true, reason: StandardResolutionReasons.TARGETING_MATCH },
      ],
      [
        'boolean disabled → false / DEFAULT',
        { key: 'flag', enabled: false },
        (p) => p.resolveBooleanEvaluation('flag', true, CTX),
        { value: false, reason: StandardResolutionReasons.DEFAULT },
      ],
      [
        'string → multivariate variant',
        { key: 'flag', enabled: true, variant: 'control' },
        (p) => p.resolveStringEvaluation('flag', 'x', CTX),
        { value: 'control', variant: 'control' },
      ],
      [
        'number → parsed variant',
        { key: 'flag', enabled: true, variant: '42' },
        (p) => p.resolveNumberEvaluation('flag', 0, CTX),
        { value: 42 },
      ],
      [
        'object → JSON payload',
        { key: 'flag', enabled: true, payload: { color: 'blue', count: 3 } },
        (p) => p.resolveObjectEvaluation('flag', {}, CTX),
        { value: { color: 'blue', count: 3 } },
      ],
      [
        'disabled flag as string → default / DEFAULT',
        { key: 'flag', enabled: false },
        (p) => p.resolveStringEvaluation('flag', 'fallback', CTX),
        { value: 'fallback', reason: StandardResolutionReasons.DEFAULT },
      ],
      [
        'disabled flag as number → default / DEFAULT',
        { key: 'flag', enabled: false },
        (p) => p.resolveNumberEvaluation('flag', 42, CTX),
        { value: 42, reason: StandardResolutionReasons.DEFAULT },
      ],
      [
        'disabled flag as object → default / DEFAULT',
        { key: 'flag', enabled: false },
        (p) => p.resolveObjectEvaluation('flag', { fallback: true }, CTX),
        { value: { fallback: true }, reason: StandardResolutionReasons.DEFAULT },
      ],
    ])('resolves %s', async (_name, result, resolve, expected) => {
      const { client } = makeClient(result)
      const details = await resolve(new PostHogServerProvider(client))
      expect(details).toMatchObject(expected)
    })

    it.each<[string, FlagResult | undefined, Resolve, ErrorCode]>([
      [
        'string from an enabled boolean flag (no variant)',
        { key: 'flag', enabled: true },
        (p) => p.resolveStringEvaluation('flag', 'x', CTX),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'number from an enabled boolean flag (no variant)',
        { key: 'flag', enabled: true },
        (p) => p.resolveNumberEvaluation('flag', 0, CTX),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'number from a non-numeric variant',
        { key: 'flag', enabled: true, variant: 'not-a-number' },
        (p) => p.resolveNumberEvaluation('flag', 0, CTX),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'number from an empty-string variant (Number("") is 0, not NaN)',
        { key: 'flag', enabled: true, variant: '' },
        (p) => p.resolveNumberEvaluation('flag', 0, CTX),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'object from an enabled flag with no payload',
        { key: 'flag', enabled: true, variant: 'x' },
        (p) => p.resolveObjectEvaluation('flag', {}, CTX),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'object from a non-object payload',
        { key: 'flag', enabled: true, payload: 'a string' },
        (p) => p.resolveObjectEvaluation('flag', {}, CTX),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'missing flag (client returns undefined)',
        undefined,
        (p) => p.resolveBooleanEvaluation('missing', false, CTX),
        ErrorCode.FLAG_NOT_FOUND,
      ],
    ])('throws on %s', async (_name, result, resolve, code) => {
      const { client } = makeClient(result)
      await expect(resolve(new PostHogServerProvider(client))).rejects.toMatchObject({ code })
    })
  })

  describe('distinct id resolution', () => {
    it('uses the targetingKey as the distinct id', async () => {
      const { client, getFeatureFlagResult } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogServerProvider(client)
      await provider.resolveBooleanEvaluation('flag', false, { targetingKey: 'abc' })
      expect(getFeatureFlagResult).toHaveBeenCalledWith('flag', 'abc', expect.any(Object))
    })

    it('falls back to defaultDistinctId when no targetingKey is set', async () => {
      const { client, getFeatureFlagResult } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogServerProvider(client, { defaultDistinctId: 'anonymous' })
      await provider.resolveBooleanEvaluation('flag', false, {})
      expect(getFeatureFlagResult).toHaveBeenCalledWith('flag', 'anonymous', expect.any(Object))
    })

    it('throws TargetingKeyMissing when neither is available', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogServerProvider(client)
      await expect(provider.resolveBooleanEvaluation('flag', false, {})).rejects.toMatchObject({
        code: ErrorCode.TARGETING_KEY_MISSING,
      })
    })
  })

  describe('context mapping', () => {
    it('forwards groups, groupProperties, and person properties', async () => {
      const { client, getFeatureFlagResult } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogServerProvider(client)
      await provider.resolveBooleanEvaluation('flag', false, {
        targetingKey: 'user_1',
        plan: 'enterprise',
        groups: { organization: 'acme' },
        groupProperties: { organization: { tier: 'gold' } },
      })
      expect(getFeatureFlagResult).toHaveBeenCalledWith('flag', 'user_1', {
        groups: { organization: 'acme' },
        personProperties: { plan: 'enterprise' },
        groupProperties: { organization: { tier: 'gold' } },
        sendFeatureFlagEvents: true,
      })
    })

    it('forwards non-string property values unchanged (no string coercion)', async () => {
      const { client, getFeatureFlagResult } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogServerProvider(client)
      await provider.resolveBooleanEvaluation('flag', false, {
        targetingKey: 'user_1',
        age: 42,
        beta: true,
        groups: { organization: 'acme' },
        groupProperties: { organization: { seats: 25 } },
      })
      expect(getFeatureFlagResult).toHaveBeenCalledWith(
        'flag',
        'user_1',
        expect.objectContaining({
          personProperties: { age: 42, beta: true },
          groupProperties: { organization: { seats: 25 } },
        })
      )
    })

    it('omits empty inputs and respects sendFeatureFlagEvents: false', async () => {
      const { client, getFeatureFlagResult } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogServerProvider(client, { sendFeatureFlagEvents: false })
      await provider.resolveBooleanEvaluation('flag', false, CTX)
      expect(getFeatureFlagResult).toHaveBeenCalledWith('flag', 'user_1', {
        groups: undefined,
        personProperties: undefined,
        groupProperties: undefined,
        sendFeatureFlagEvents: false,
      })
    })
  })

  describe('initialize', () => {
    it('preloads flags via reloadFeatureFlags', async () => {
      const { client, reloadFeatureFlags } = makeClient(undefined)
      const provider = new PostHogServerProvider(client)
      await provider.initialize()
      expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
    })

    it('warns (without rejecting) when the client emits an error during preload', async () => {
      const { client, reloadFeatureFlags, emit } = makeClient(undefined)
      const preloadError = new Error('bad response')
      // posthog-node never rejects reloadFeatureFlags — it surfaces the failure
      // on the `error` event, which fires while the reload is in flight.
      reloadFeatureFlags.mockImplementationOnce(async () => {
        emit('error', preloadError)
      })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const provider = new PostHogServerProvider(client)
        await expect(provider.initialize()).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('flag preload failed'), preloadError)
      } finally {
        warn.mockRestore()
      }
    })

    it('does not warn when preloading succeeds', async () => {
      const { client } = makeClient(undefined)
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        await new PostHogServerProvider(client).initialize()
        expect(warn).not.toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
    })
  })

  describe('end-to-end through the OpenFeature client', () => {
    afterEach(async () => {
      await OpenFeature.close()
    })

    it('resolves values and details through the real client', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true, variant: 'control', payload: { a: 1 } })
      await OpenFeature.setProviderAndWait(new PostHogServerProvider(client))
      const ofClient = OpenFeature.getClient()

      expect(await ofClient.getBooleanValue('flag', false, CTX)).toBe(true)
      expect(await ofClient.getStringValue('flag', 'x', CTX)).toBe('control')

      const details = await ofClient.getObjectDetails('flag', {}, CTX)
      expect(details.value).toEqual({ a: 1 })
      expect(details.reason).toBe(StandardResolutionReasons.TARGETING_MATCH)
    })

    it('returns the default value with an error code on a type mismatch', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true })
      await OpenFeature.setProviderAndWait(new PostHogServerProvider(client))
      const ofClient = OpenFeature.getClient()

      const details = await ofClient.getStringDetails('flag', 'fallback', CTX)
      expect(details.value).toBe('fallback')
      expect(details.errorCode).toBe(ErrorCode.TYPE_MISMATCH)
      expect(details.reason).toBe(StandardResolutionReasons.ERROR)
    })

    it('returns the default value with FLAG_NOT_FOUND for a missing flag', async () => {
      const { client } = makeClient(undefined)
      await OpenFeature.setProviderAndWait(new PostHogServerProvider(client))
      const ofClient = OpenFeature.getClient()

      const details = await ofClient.getBooleanDetails('missing', true, CTX)
      expect(details.value).toBe(true)
      expect(details.errorCode).toBe(ErrorCode.FLAG_NOT_FOUND)
    })
  })
})
