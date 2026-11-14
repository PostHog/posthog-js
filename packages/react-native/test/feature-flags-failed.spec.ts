import { PostHog, PostHogPersistedProperty } from '../src'
import { Linking, AppState } from 'react-native'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('failed React Native feature flag records', () => {
  vi.useRealTimers()

  it.each([false, true])(
    'reopens pre-fix persisted failures offline without losing response-wide errors (bootstrap %s)',
    async (bootstrap) => {
      const stored: Record<string, string> = {
        '.posthog-rn.json': JSON.stringify({
          version: 'v1',
          content: {
            [PostHogPersistedProperty.FeatureFlagDetails]: {
              flags: {
                failed: {
                  key: 'failed',
                  enabled: true,
                  variant: 'placeholder',
                  failed: true,
                  metadata: { payload: '{"remote":true}' },
                },
              },
              errorsWhileComputingFlags: true,
            },
            [PostHogPersistedProperty.FeatureFlags]: { failed: 'placeholder' },
            [PostHogPersistedProperty.FeatureFlagPayloads]: { failed: { remote: true } },
          },
        }),
      }
      const fetch = vi.fn(async (url: string) => ({
        status: url.includes('/flags') || url.includes('/config') ? 503 : 200,
        json: async () => ({}),
      }))
      ;(globalThis as any).window.fetch = fetch
      for (let reopen = 0; reopen < 2; reopen++) {
        const posthog = new PostHog('token', {
          preloadFeatureFlags: false,
          flushInterval: 0,
          fetchRetryCount: 0,
          customStorage: {
            getItem: async (key) => stored[key] ?? null,
            setItem: async (key, value) => {
              stored[key] = value
            },
          },
          ...(bootstrap ? { bootstrap: { featureFlags: { healthy: true } } } : {}),
        })
        try {
          await posthog.ready()
          const capture = vi.spyOn(posthog, 'capture')
          expect(posthog.getFeatureFlagResult('failed', { sendEvent: false })).toBeUndefined()
          expect(posthog.isFeatureEnabled('failed', { defaultValue: true })).toBe(true)
          expect(posthog.getAllFeatureFlags().map(({ key }) => key)).toEqual(bootstrap ? ['healthy'] : [])
          expect(posthog.getFeatureFlagPayloads()).not.toHaveProperty('failed')
          expect(capture).toHaveBeenCalledWith(
            '$feature_flag_called',
            expect.objectContaining({
              $feature_flag_response: undefined,
              $feature_flag_error: 'errors_while_computing_flags,evaluation_failed',
            })
          )
          expect(fetch.mock.calls.some(([url]) => String(url).includes('/flags'))).toBe(false)
        } finally {
          await posthog.shutdown()
        }
      }
    }
  )

  it('uses same-key bootstrap over failed persisted state across reopen and clears it on a complete refresh', async () => {
    const stored: Record<string, string> = {
      '.posthog-rn.json': JSON.stringify({
        version: 'v1',
        content: {
          [PostHogPersistedProperty.FeatureFlagDetails]: {
            flags: {
              failed: { key: 'failed', enabled: false, failed: true, metadata: { payload: '{"remote":true}' } },
              healthy: { key: 'healthy', enabled: false, metadata: {} },
              unresolved: { key: 'unresolved', enabled: false, failed: true, metadata: {} },
            },
            errorsWhileComputingFlags: true,
          },
        },
      }),
    }
    const fetch = vi.fn(async (url: string) => ({
      status: url.includes('/flags') || url.includes('/config') ? 503 : 200,
      json: async () => ({}),
    }))
    ;(globalThis as any).window.fetch = fetch
    for (let reopen = 0; reopen < 2; reopen++) {
      const posthog = new PostHog('token', {
        preloadFeatureFlags: false,
        flushInterval: 0,
        fetchRetryCount: 0,
        customStorage: {
          getItem: async (key) => stored[key] ?? null,
          setItem: async (key, value) => {
            stored[key] = value
          },
        },
        bootstrap: {
          featureFlags: { failed: 'bootstrap-success', healthy: true },
          featureFlagPayloads: { failed: { bootstrap: true } },
        },
      })
      try {
        await posthog.ready()
        const capture = vi.spyOn(posthog, 'capture')
        expect(posthog.getFeatureFlagResult('failed')).toMatchObject({
          variant: 'bootstrap-success',
          payload: { bootstrap: true },
        })
        expect(capture.mock.calls[0][1].$feature_flag_error).toBe('errors_while_computing_flags')
        expect(posthog.isFeatureEnabled('healthy', { defaultValue: true, sendEvent: false })).toBe(false)
        expect(posthog.getFeatureFlagResult('unresolved', { sendEvent: false })).toBeUndefined()
        if (reopen === 1) {
          fetch.mockImplementation(async () => ({ status: 200, json: async () => ({ flags: {} }) }))
          await posthog.reloadFeatureFlagsAsync()
          expect(posthog.getFeatureFlagResult('failed', { sendEvent: false })).toBeUndefined()
          expect(posthog.getAllFeatureFlags()).toEqual([])
        }
      } finally {
        await posthog.shutdown()
      }
    }
  })

  it.each([true, false, undefined])(
    'honors true defaults without exposing failed false (%s)',
    async (errorsWhileComputingFlags) => {
      ;(globalThis as any).window.fetch = vi.fn(async (url: string) => ({
        status: 200,
        json: async () =>
          url.includes('/flags')
            ? {
                flags: {
                  failed: { key: 'failed', enabled: false, failed: true, metadata: { payload: '{"failed":true}' } },
                  disabled: { key: 'disabled', enabled: false, metadata: {} },
                },
                errorsWhileComputingFlags,
              }
            : {},
      }))
      const posthog = new PostHog('token', { persistence: 'memory', flushInterval: 0, preloadFeatureFlags: false })
      try {
        await posthog.ready()
        await posthog.reloadFeatureFlagsAsync()
        const capture = vi.spyOn(posthog, 'capture')
        expect(posthog.getFeatureFlagResult('failed', { sendEvent: false })).toBeUndefined()
        expect(capture).not.toHaveBeenCalled()
        expect(posthog.isFeatureEnabled('failed', { defaultValue: true })).toBe(true)
        expect(capture).toHaveBeenCalledWith(
          '$feature_flag_called',
          expect.objectContaining({
            $feature_flag_response: undefined,
            $feature_flag_error: errorsWhileComputingFlags
              ? 'errors_while_computing_flags,evaluation_failed'
              : 'evaluation_failed',
          })
        )
        expect(posthog.isFeatureEnabled('disabled', { defaultValue: true })).toBe(false)
        expect(posthog.getAllFeatureFlags().map(({ key }) => key)).toEqual(['disabled'])
        expect(posthog.getFeatureFlagPayloads()).toEqual({})
      } finally {
        await posthog.shutdown()
      }
    }
  )
})
