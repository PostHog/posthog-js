import { ErrorCode, OpenFeature, StandardResolutionReasons, type ResolutionDetails } from '@openfeature/server-sdk'
import type { PostHog } from 'posthog-node'

import { PostHogServerProvider } from '../server-provider'

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
} {
  const getFeatureFlagResult = jest.fn().mockResolvedValue(result)
  const reloadFeatureFlags = jest.fn().mockResolvedValue(undefined)
  return {
    client: { getFeatureFlagResult, reloadFeatureFlags } as unknown as PostHog,
    getFeatureFlagResult,
    reloadFeatureFlags,
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
    ])('resolves %s', async (_name, result, resolve, expected) => {
      const { client } = makeClient(result)
      const details = await resolve(new PostHogServerProvider(client))
      expect(details).toMatchObject(expected)
    })

    it.each<[string, FlagResult | undefined, Resolve, ErrorCode]>([
      [
        'string from a boolean flag (no variant)',
        { key: 'flag', enabled: true },
        (p) => p.resolveStringEvaluation('flag', 'x', CTX),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'number from a non-numeric variant',
        { key: 'flag', enabled: true, variant: 'not-a-number' },
        (p) => p.resolveNumberEvaluation('flag', 0, CTX),
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

    it('does not reject when preloading fails', async () => {
      const { client, reloadFeatureFlags } = makeClient(undefined)
      reloadFeatureFlags.mockRejectedValueOnce(new Error('no personal api key'))
      const provider = new PostHogServerProvider(client)
      await expect(provider.initialize()).resolves.toBeUndefined()
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
