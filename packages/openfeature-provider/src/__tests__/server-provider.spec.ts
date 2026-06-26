import { ErrorCode, OpenFeature, StandardResolutionReasons } from '@openfeature/server-sdk'
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

describe('PostHogServerProvider', () => {
  describe('metadata', () => {
    it('identifies as a server provider', () => {
      const { client } = makeClient(undefined)
      const provider = new PostHogServerProvider(client)
      expect(provider.metadata.name).toBe('PostHogServerProvider')
      expect(provider.runsOn).toBe('server')
    })
  })

  describe('boolean resolution', () => {
    it('maps an enabled flag to true with TARGETING_MATCH', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogServerProvider(client)
      const details = await provider.resolveBooleanEvaluation('flag', false, CTX)
      expect(details.value).toBe(true)
      expect(details.reason).toBe(StandardResolutionReasons.TARGETING_MATCH)
    })

    it('maps a disabled flag to false with DEFAULT', async () => {
      const { client } = makeClient({ key: 'flag', enabled: false })
      const provider = new PostHogServerProvider(client)
      const details = await provider.resolveBooleanEvaluation('flag', true, CTX)
      expect(details.value).toBe(false)
      expect(details.reason).toBe(StandardResolutionReasons.DEFAULT)
    })
  })

  describe('string resolution', () => {
    it('returns the multivariate variant', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true, variant: 'control' })
      const provider = new PostHogServerProvider(client)
      const details = await provider.resolveStringEvaluation('flag', 'x', CTX)
      expect(details.value).toBe('control')
      expect(details.variant).toBe('control')
    })

    it('throws TypeMismatch for a boolean flag with no variant', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogServerProvider(client)
      await expect(provider.resolveStringEvaluation('flag', 'x', CTX)).rejects.toMatchObject({
        code: ErrorCode.TYPE_MISMATCH,
      })
    })
  })

  describe('number resolution', () => {
    it('parses a numeric variant', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true, variant: '42' })
      const provider = new PostHogServerProvider(client)
      const details = await provider.resolveNumberEvaluation('flag', 0, CTX)
      expect(details.value).toBe(42)
    })

    it('throws TypeMismatch for a non-numeric variant', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true, variant: 'not-a-number' })
      const provider = new PostHogServerProvider(client)
      await expect(provider.resolveNumberEvaluation('flag', 0, CTX)).rejects.toMatchObject({
        code: ErrorCode.TYPE_MISMATCH,
      })
    })
  })

  describe('object resolution', () => {
    it('returns the JSON payload', async () => {
      const payload = { color: 'blue', count: 3 }
      const { client } = makeClient({ key: 'flag', enabled: true, payload })
      const provider = new PostHogServerProvider(client)
      const details = await provider.resolveObjectEvaluation('flag', {}, CTX)
      expect(details.value).toEqual(payload)
    })

    it('throws TypeMismatch when there is no object payload', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true, payload: 'a string' })
      const provider = new PostHogServerProvider(client)
      await expect(provider.resolveObjectEvaluation('flag', {}, CTX)).rejects.toMatchObject({
        code: ErrorCode.TYPE_MISMATCH,
      })
    })
  })

  describe('missing flags', () => {
    it('throws FlagNotFound when the client returns undefined', async () => {
      const { client } = makeClient(undefined)
      const provider = new PostHogServerProvider(client)
      await expect(provider.resolveBooleanEvaluation('missing', false, CTX)).rejects.toMatchObject({
        code: ErrorCode.FLAG_NOT_FOUND,
      })
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
