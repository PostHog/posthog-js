import { ErrorCode, OpenFeature, StandardResolutionReasons, type ResolutionDetails } from '@openfeature/web-sdk'
import type { PostHog } from 'posthog-js'

import { PostHogWebProvider } from '../provider'

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

type Resolve = (provider: PostHogWebProvider) => ResolutionDetails<unknown>

describe('PostHogWebProvider', () => {
  it('identifies as a client provider', () => {
    const { client } = makeClient(undefined)
    const provider = new PostHogWebProvider(client)
    expect(provider.metadata.name).toBe('PostHogWebProvider')
    expect(provider.runsOn).toBe('client')
  })

  describe('synchronous resolution', () => {
    it.each<[string, FlagResult, Resolve, Partial<ResolutionDetails<unknown>>]>([
      [
        'boolean enabled → true / TARGETING_MATCH',
        { key: 'flag', enabled: true },
        (p) => p.resolveBooleanEvaluation('flag', false),
        { value: true, reason: StandardResolutionReasons.TARGETING_MATCH },
      ],
      [
        'boolean disabled → false / DEFAULT',
        { key: 'flag', enabled: false },
        (p) => p.resolveBooleanEvaluation('flag', true),
        { value: false, reason: StandardResolutionReasons.DEFAULT },
      ],
      [
        'string → multivariate variant',
        { key: 'flag', enabled: true, variant: 'control' },
        (p) => p.resolveStringEvaluation('flag', 'x'),
        { value: 'control', variant: 'control' },
      ],
      [
        'number → parsed variant',
        { key: 'flag', enabled: true, variant: '7' },
        (p) => p.resolveNumberEvaluation('flag', 0),
        { value: 7 },
      ],
      [
        'object → JSON payload',
        { key: 'flag', enabled: true, payload: { a: 1 } },
        (p) => p.resolveObjectEvaluation('flag', {}),
        { value: { a: 1 } },
      ],
      [
        'disabled flag as string → default / DEFAULT',
        { key: 'flag', enabled: false },
        (p) => p.resolveStringEvaluation('flag', 'fallback'),
        { value: 'fallback', reason: StandardResolutionReasons.DEFAULT },
      ],
      [
        'disabled flag as number → default / DEFAULT',
        { key: 'flag', enabled: false },
        (p) => p.resolveNumberEvaluation('flag', 42),
        { value: 42, reason: StandardResolutionReasons.DEFAULT },
      ],
      [
        'disabled flag as object → default / DEFAULT',
        { key: 'flag', enabled: false },
        (p) => p.resolveObjectEvaluation('flag', { fallback: true }),
        { value: { fallback: true }, reason: StandardResolutionReasons.DEFAULT },
      ],
    ])('resolves %s', (_name, result, resolve, expected) => {
      const { client } = makeClient(result)
      expect(resolve(new PostHogWebProvider(client))).toMatchObject(expected)
    })

    it.each<[string, FlagResult | undefined, Resolve, ErrorCode]>([
      [
        'string from an enabled boolean flag (no variant)',
        { key: 'flag', enabled: true },
        (p) => p.resolveStringEvaluation('flag', 'x'),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'number from an enabled boolean flag (no variant)',
        { key: 'flag', enabled: true },
        (p) => p.resolveNumberEvaluation('flag', 0),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'number from a non-numeric variant',
        { key: 'flag', enabled: true, variant: 'not-a-number' },
        (p) => p.resolveNumberEvaluation('flag', 0),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'object from an enabled flag with no payload',
        { key: 'flag', enabled: true, variant: 'x' },
        (p) => p.resolveObjectEvaluation('flag', {}),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'object from a non-object payload',
        { key: 'flag', enabled: true, variant: 'x', payload: 'not-an-object' },
        (p) => p.resolveObjectEvaluation('flag', {}),
        ErrorCode.TYPE_MISMATCH,
      ],
      [
        'missing flag (client returns undefined)',
        undefined,
        (p) => p.resolveBooleanEvaluation('missing', false),
        ErrorCode.FLAG_NOT_FOUND,
      ],
    ])('throws on %s', (_name, result, resolve, code) => {
      const { client } = makeClient(result)
      expect(() => resolve(new PostHogWebProvider(client))).toThrow(expect.objectContaining({ code }))
    })

    it('passes send_event through to the client', () => {
      const { client, getFeatureFlagResult } = makeClient({ key: 'flag', enabled: true })
      new PostHogWebProvider(client, { sendFeatureFlagEvents: false }).resolveBooleanEvaluation('flag', false)
      expect(getFeatureFlagResult).toHaveBeenCalledWith('flag', { send_event: false })
    })

    it('defaults send_event to true', () => {
      const { client, getFeatureFlagResult } = makeClient({ key: 'flag', enabled: true })
      new PostHogWebProvider(client).resolveBooleanEvaluation('flag', false)
      expect(getFeatureFlagResult).toHaveBeenCalledWith('flag', { send_event: true })
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

    it('resolves on timeout when the flags callback never fires', async () => {
      // onFeatureFlags never invokes its callback and reloadFeatureFlags is a no-op,
      // so only the reloadTimeoutMs safety net can settle initialize(). Fake timers
      // keep this deterministic and instant rather than waiting on real wall-clock.
      jest.useFakeTimers()
      try {
        const client = {
          getFeatureFlagResult: jest.fn(),
          reloadFeatureFlags: jest.fn(),
          onFeatureFlags: jest.fn(() => () => {}),
          setPersonPropertiesForFlags: jest.fn(),
          group: jest.fn(),
        } as unknown as PostHog
        const provider = new PostHogWebProvider(client, { reloadTimeoutMs: 20 })
        const pending = provider.initialize()
        await jest.runAllTimersAsync()
        await expect(pending).resolves.toBeUndefined()
      } finally {
        jest.useRealTimers()
      }
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

    it('calls group without properties when groupProperties are absent', async () => {
      const { client, group } = makeClient({ key: 'flag', enabled: true })
      const provider = new PostHogWebProvider(client)
      await provider.onContextChange({}, { groups: { organization: 'acme' } })
      expect(group).toHaveBeenCalledWith('organization', 'acme', undefined)
    })

    it('skips reconciliation when the context is deeply unchanged', async () => {
      const { client, reloadFeatureFlags, setPersonPropertiesForFlags, group } = makeClient({
        key: 'flag',
        enabled: true,
      })
      const provider = new PostHogWebProvider(client)
      const ctx = { targetingKey: 'user_1', plan: 'pro', groups: { organization: 'acme' } }
      // Deeply-equal but distinct object instances (as a re-render would produce).
      await provider.onContextChange(ctx, { ...ctx, groups: { ...ctx.groups } })
      expect(reloadFeatureFlags).not.toHaveBeenCalled()
      expect(setPersonPropertiesForFlags).not.toHaveBeenCalled()
      expect(group).not.toHaveBeenCalled()
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
