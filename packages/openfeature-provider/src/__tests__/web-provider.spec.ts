import { ErrorCode, OpenFeature, StandardResolutionReasons } from '@openfeature/web-sdk'
import type { PostHog } from 'posthog-js'

import { PostHogWebProvider } from '../web-provider'

type FlagResult = {
  key: string
  enabled: boolean
  variant?: string
  payload?: unknown
}

function makeClient(
  result: FlagResult | undefined,
  { alreadyLoaded = false }: { alreadyLoaded?: boolean } = {}
): {
  client: PostHog
  getFeatureFlagResult: jest.Mock
  reloadFeatureFlags: jest.Mock
  onFeatureFlags: jest.Mock
  setPersonPropertiesForFlags: jest.Mock
  group: jest.Mock
} {
  let callback: ((flags: string[], variants: Record<string, unknown>) => void) | undefined

  const onFeatureFlags = jest.fn((cb: (flags: string[], variants: Record<string, unknown>) => void) => {
    callback = cb
    // posthog-js fires synchronously on subscribe when flags are already loaded.
    if (alreadyLoaded) {
      cb([], {})
    }
    return () => {
      callback = undefined
    }
  })
  // Simulate an async reload that notifies subscribers on completion.
  const reloadFeatureFlags = jest.fn(() => {
    queueMicrotask(() => callback?.([], {}))
  })
  const getFeatureFlagResult = jest.fn().mockReturnValue(result)
  const setPersonPropertiesForFlags = jest.fn()
  const group = jest.fn()

  return {
    client: {
      getFeatureFlagResult,
      reloadFeatureFlags,
      onFeatureFlags,
      setPersonPropertiesForFlags,
      group,
    } as unknown as PostHog,
    getFeatureFlagResult,
    reloadFeatureFlags,
    onFeatureFlags,
    setPersonPropertiesForFlags,
    group,
  }
}

describe('PostHogWebProvider', () => {
  describe('metadata', () => {
    it('identifies as a client provider', () => {
      const { client } = makeClient(undefined)
      const provider = new PostHogWebProvider(client)
      expect(provider.metadata.name).toBe('PostHogWebProvider')
      expect(provider.runsOn).toBe('client')
    })
  })

  describe('synchronous resolution', () => {
    it('maps an enabled flag to true with TARGETING_MATCH', () => {
      const { client } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogWebProvider(client)
      const details = provider.resolveBooleanEvaluation('flag', false)
      expect(details.value).toBe(true)
      expect(details.reason).toBe(StandardResolutionReasons.TARGETING_MATCH)
    })

    it('maps a disabled flag to false with DEFAULT', () => {
      const { client } = makeClient({ key: 'flag', enabled: false })
      const provider = new PostHogWebProvider(client)
      const details = provider.resolveBooleanEvaluation('flag', true)
      expect(details.value).toBe(false)
      expect(details.reason).toBe(StandardResolutionReasons.DEFAULT)
    })

    it('returns the multivariate variant for strings', () => {
      const { client } = makeClient({ key: 'flag', enabled: true, variant: 'control' })
      const provider = new PostHogWebProvider(client)
      expect(provider.resolveStringEvaluation('flag', 'x').value).toBe('control')
    })

    it('parses a numeric variant', () => {
      const { client } = makeClient({ key: 'flag', enabled: true, variant: '7' })
      const provider = new PostHogWebProvider(client)
      expect(provider.resolveNumberEvaluation('flag', 0).value).toBe(7)
    })

    it('returns the JSON payload for objects', () => {
      const { client } = makeClient({ key: 'flag', enabled: true, payload: { a: 1 } })
      const provider = new PostHogWebProvider(client)
      expect(provider.resolveObjectEvaluation('flag', {}).value).toEqual({ a: 1 })
    })

    it('throws TypeMismatch for a boolean flag asked for a string', () => {
      const { client } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogWebProvider(client)
      expect(() => provider.resolveStringEvaluation('flag', 'x')).toThrow(
        expect.objectContaining({ code: ErrorCode.TYPE_MISMATCH })
      )
    })

    it('throws FlagNotFound for a missing flag', () => {
      const { client } = makeClient(undefined)
      const provider = new PostHogWebProvider(client)
      expect(() => provider.resolveBooleanEvaluation('missing', false)).toThrow(
        expect.objectContaining({ code: ErrorCode.FLAG_NOT_FOUND })
      )
    })

    it('passes send_event through to the client', () => {
      const { client, getFeatureFlagResult } = makeClient({ key: 'flag', enabled: true })
      new PostHogWebProvider(client, { sendFeatureFlagEvents: false }).resolveBooleanEvaluation('flag', false)
      expect(getFeatureFlagResult).toHaveBeenCalledWith('flag', { send_event: false })
    })
  })

  describe('initialize / reconciliation', () => {
    it('reloads flags on initialize and resolves once loaded', async () => {
      const { client, reloadFeatureFlags } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogWebProvider(client)
      await provider.initialize()
      expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
    })

    it('resolves even when flags were already loaded (ignores the immediate fire)', async () => {
      const { client, reloadFeatureFlags } = makeClient({ key: 'flag', enabled: true }, { alreadyLoaded: true })
      const provider = new PostHogWebProvider(client)
      await expect(provider.initialize()).resolves.toBeUndefined()
      expect(reloadFeatureFlags).toHaveBeenCalledTimes(1)
    })

    it('reconciles person properties and groups from the context on change', async () => {
      const { client, setPersonPropertiesForFlags, group } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogWebProvider(client)
      await provider.onContextChange(
        {},
        {
          targetingKey: 'user_1',
          plan: 'enterprise',
          groups: { organization: 'acme' },
          groupProperties: { organization: { tier: 'gold' } },
        }
      )
      // reload suppressed on the property write — a single trailing reload is awaited instead
      expect(setPersonPropertiesForFlags).toHaveBeenCalledWith({ plan: 'enterprise' }, false)
      expect(group).toHaveBeenCalledWith('organization', 'acme', { tier: 'gold' })
    })

    it('does not touch person properties when none are provided', async () => {
      const { client, setPersonPropertiesForFlags } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogWebProvider(client)
      await provider.onContextChange({}, { targetingKey: 'user_1' })
      expect(setPersonPropertiesForFlags).not.toHaveBeenCalled()
    })
  })

  describe('end-to-end through the OpenFeature client', () => {
    afterEach(async () => {
      await OpenFeature.close()
    })

    it('resolves values synchronously through the real client', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true, variant: 'control', payload: { a: 1 } })
      await OpenFeature.setProviderAndWait(new PostHogWebProvider(client))
      const ofClient = OpenFeature.getClient()

      expect(ofClient.getBooleanValue('flag', false)).toBe(true)
      expect(ofClient.getStringValue('flag', 'x')).toBe('control')
      expect(ofClient.getObjectDetails('flag', {}).value).toEqual({ a: 1 })
    })

    it('returns the default value with an error code on a type mismatch', async () => {
      const { client } = makeClient({ key: 'flag', enabled: true })
      await OpenFeature.setProviderAndWait(new PostHogWebProvider(client))
      const ofClient = OpenFeature.getClient()

      const details = ofClient.getStringDetails('flag', 'fallback')
      expect(details.value).toBe('fallback')
      expect(details.errorCode).toBe(ErrorCode.TYPE_MISMATCH)
      expect(details.reason).toBe(StandardResolutionReasons.ERROR)
    })
  })
})
