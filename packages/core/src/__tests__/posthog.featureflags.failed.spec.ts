import { createTestClient, waitForPromises } from '@/testing'
import { PostHogPersistedProperty } from '@/types'

const failed = {
  key: 'failed',
  enabled: true,
  variant: 'placeholder',
  failed: true,
  metadata: { id: 42, version: 3, payload: '{"remote":true}' },
  reason: { code: 'dependency_error' },
}

describe('failed client flag records', () => {
  vi.useFakeTimers()

  it.each([true, false, undefined])(
    'filters failures and tracks no-result with global errors %s',
    async (errorsWhileComputingFlags) => {
      const [posthog, mocks] = createTestClient('token', { flushAt: 1 })
      mocks.fetch.mockResolvedValue({
        status: 200,
        json: async () => ({
          flags: { failed, disabled: { key: 'disabled', enabled: false, failed: false, metadata: {} } },
          errorsWhileComputingFlags,
        }),
      })
      await posthog.reloadFeatureFlagsAsync()
      const capture = vi.spyOn(posthog, 'capture')
      expect(posthog.getFeatureFlagResult('failed', { sendEvent: false })).toBeUndefined()
      expect(capture).not.toHaveBeenCalled()
      expect(posthog.isFeatureEnabled('failed', { defaultValue: true })).toBe(true)
      expect(posthog.getFeatureFlagResult('failed')).toBeUndefined()
      expect(capture).toHaveBeenCalledTimes(1)
      expect(capture).toHaveBeenCalledWith(
        '$feature_flag_called',
        expect.objectContaining({
          $feature_flag_response: undefined,
          $feature_flag_error: errorsWhileComputingFlags
            ? 'errors_while_computing_flags,evaluation_failed'
            : 'evaluation_failed',
          $feature_flag_id: 42,
          $feature_flag_reason: 'dependency_error',
        })
      )
      expect(posthog.isFeatureEnabled('disabled', { defaultValue: true })).toBe(false)
      expect(posthog.getAllFeatureFlags().map(({ key }) => key)).toEqual(['disabled'])
      expect(posthog.getFeatureFlagPayloads()).toEqual({})
      await posthog.shutdown()
      await waitForPromises()
    }
  )

  it.each(['quota_limited', 'timeout', 'api_error_503', 'connection_error'])(
    'retained failed diagnostics after unsuccessful reload (%s)',
    async (requestError) => {
      const [posthog, mocks] = createTestClient('token', {
        fetchRetryCount: 0,
        featureFlagsRequestMaxRetries: 0,
      })
      try {
        mocks.fetch.mockResolvedValueOnce({
          status: 200,
          json: async () => ({
            flags: { failed, disabled: { key: 'disabled', enabled: false, metadata: {} } },
            errorsWhileComputingFlags: true,
          }),
        })
        await posthog.reloadFeatureFlagsAsync()
        if (requestError === 'quota_limited') {
          mocks.fetch.mockResolvedValueOnce({ status: 200, json: async () => ({ quotaLimited: ['feature_flags'] }) })
        } else if (requestError === 'api_error_503') {
          mocks.fetch.mockResolvedValueOnce({ status: 503, text: async () => 'Service Unavailable' })
        } else {
          const error = new Error('Request failed')
          error.name = requestError === 'timeout' ? 'AbortError' : 'TypeError'
          mocks.fetch.mockRejectedValueOnce(error)
        }
        await posthog.reloadFeatureFlagsAsync()

        const capture = vi.spyOn(posthog, 'capture')
        expect(posthog.getFeatureFlagResult('failed')).toBeUndefined()
        expect(posthog.getFeatureFlagResult('disabled')).toMatchObject({ enabled: false })
        expect(posthog.getFeatureFlagResult('missing')).toBeUndefined()
        expect(capture).toHaveBeenCalledTimes(3)
        expect(capture).toHaveBeenNthCalledWith(
          1,
          '$feature_flag_called',
          expect.objectContaining({
            $feature_flag_response: undefined,
            $feature_flag_error: `${requestError},evaluation_failed`,
            $feature_flag_id: 42,
            $feature_flag_reason: 'dependency_error',
          })
        )
        for (const call of [2, 3]) {
          expect(capture).toHaveBeenNthCalledWith(
            call,
            '$feature_flag_called',
            expect.objectContaining({ $feature_flag_error: requestError })
          )
        }
      } finally {
        await posthog.shutdown()
      }
    }
  )

  it.each(
    [true, false, undefined].flatMap((errorsWhileComputingFlags) =>
      [false, true].map((healthyFalseCache) => ({ errorsWhileComputingFlags, healthyFalseCache }))
    )
  )(
    'cold failed-only records do not establish a legacy non-empty value cache (%j)',
    async ({ errorsWhileComputingFlags, healthyFalseCache }) => {
      const [posthog, mocks] = createTestClient('token')
      try {
        mocks.fetch.mockResolvedValueOnce({
          status: 200,
          json: async () => ({
            flags: {
              failed,
              ...(healthyFalseCache ? { disabled: { key: 'disabled', enabled: false, metadata: {} } } : {}),
            },
            errorsWhileComputingFlags,
          }),
        })
        await posthog.reloadFeatureFlagsAsync()

        for (const key of ['failed', 'missing']) {
          expect(posthog.getFeatureFlag(key, { sendEvent: false })).toBe(healthyFalseCache ? false : undefined)
          expect(posthog.isFeatureEnabled(key, { sendEvent: false })).toBe(healthyFalseCache ? false : undefined)
          expect(posthog.getFeatureFlagResult(key, { sendEvent: false })).toBeUndefined()
          expect(posthog.isFeatureEnabled(key, { defaultValue: true, sendEvent: false })).toBe(true)
          expect(posthog.getFeatureFlagPayload(key)).toBeNull()
        }
        expect(posthog.getFeatureFlags()).toEqual(healthyFalseCache ? { disabled: false } : {})
        expect(posthog.getFeatureFlagDetails()?.flags.failed.failed).toBe(true)
        if (healthyFalseCache) {
          expect(posthog.getFeatureFlag('disabled', { sendEvent: false })).toBe(false)
          expect(posthog.isFeatureEnabled('disabled', { defaultValue: true, sendEvent: false })).toBe(false)
        }
      } finally {
        await posthog.shutdown()
      }
    }
  )

  it.each([false, true])(
    'filters pre-fix persisted failures and preserves diagnostics on reopen (bootstrap %s)',
    async (bootstrap) => {
      const cache = {
        [PostHogPersistedProperty.FeatureFlagDetails]: { flags: { failed }, errorsWhileComputingFlags: true },
        [PostHogPersistedProperty.FeatureFlags]: { failed: 'placeholder' },
        [PostHogPersistedProperty.FeatureFlagPayloads]: { failed: { remote: true } },
      }
      const [posthog, mocks] = createTestClient(
        'token',
        bootstrap ? { bootstrap: { featureFlags: { healthy: true } } } : {},
        undefined,
        cache
      )
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
      expect(mocks.fetch).not.toHaveBeenCalled()
      await posthog.shutdown()
    }
  )

  it.each(['failed', 'fresh'])('bootstrap does not carry a prior request failure (%s)', async (bootstrapKey) => {
    const cache = {
      [PostHogPersistedProperty.FeatureFlagDetails]: {
        flags: { failed, unresolved: { ...failed, key: 'unresolved' } },
        requestError: { type: 'timeout' },
        errorsWhileComputingFlags: true,
        minimalFlagCalledEvents: true,
        quotaLimited: ['feature_flags'],
        evaluatedAt: 1234,
      },
    }
    const [posthog, mocks] = createTestClient(
      'token',
      {
        bootstrap: {
          featureFlags: { [bootstrapKey]: 'bootstrap-success' },
          featureFlagPayloads: { [bootstrapKey]: { bootstrap: true } },
        },
      },
      undefined,
      cache
    )
    try {
      const capture = vi.spyOn(posthog, 'capture')
      expect(posthog.getFeatureFlagResult(bootstrapKey)).toMatchObject({
        variant: 'bootstrap-success',
        payload: { bootstrap: true },
      })
      expect(capture.mock.calls[0][1].$feature_flag_error).toBe('errors_while_computing_flags,quota_limited')
      expect(posthog.getFeatureFlagDetails()).toMatchObject({
        errorsWhileComputingFlags: true,
        minimalFlagCalledEvents: true,
        quotaLimited: ['feature_flags'],
        evaluatedAt: 1234,
      })
      expect(cache[PostHogPersistedProperty.FeatureFlagDetails].requestError).toBeUndefined()
      expect(posthog.getFeatureFlagResult('unresolved')).toBeUndefined()
      expect(capture.mock.calls[1][1].$feature_flag_error).toBe(
        'errors_while_computing_flags,quota_limited,evaluation_failed'
      )
      expect(mocks.fetch).not.toHaveBeenCalled()
    } finally {
      await posthog.shutdown()
    }
  })

  it.each([true, false, 'cached'])(
    'uses same-key bootstrap only over failed persisted decisions, including reopen (healthy %s)',
    async (healthyValue) => {
      const healthy = {
        ...failed,
        key: 'healthy',
        failed: false,
        enabled: healthyValue !== false,
        variant: typeof healthyValue === 'string' ? healthyValue : undefined,
        metadata: { payload: '{"cached":true}' },
      }
      const cache = {
        [PostHogPersistedProperty.FeatureFlagDetails]: {
          flags: { failed, healthy, unresolved: { ...failed, key: 'unresolved' } },
          errorsWhileComputingFlags: true,
        },
      }
      for (let reopen = 0; reopen < 2; reopen++) {
        const [posthog, mocks] = createTestClient(
          'token',
          {
            bootstrap: {
              featureFlags: { failed: 'bootstrap-success', healthy: 'ignored-bootstrap' },
              featureFlagPayloads: { failed: { bootstrap: true }, healthy: { ignored: true } },
            },
          },
          undefined,
          cache
        )
        try {
          const capture = vi.spyOn(posthog, 'capture')
          expect(posthog.getFeatureFlagResult('failed')).toMatchObject({
            variant: 'bootstrap-success',
            payload: { bootstrap: true },
          })
          expect(capture.mock.calls[0][1].$feature_flag_error).toBe('errors_while_computing_flags')
          expect(posthog.getFeatureFlagResult('healthy', { sendEvent: false })).toMatchObject({
            enabled: healthyValue !== false,
            variant: typeof healthyValue === 'string' ? healthyValue : undefined,
            payload: { cached: true },
          })
          expect(posthog.getFeatureFlagResult('unresolved', { sendEvent: false })).toBeUndefined()
          expect(mocks.fetch).not.toHaveBeenCalled()
          if (reopen === 1) {
            mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ flags: {} }) })
            await posthog.reloadFeatureFlagsAsync()
            expect(posthog.getFeatureFlagResult('failed', { sendEvent: false })).toBeUndefined()
            expect(posthog.getAllFeatureFlags()).toEqual([])
          }
        } finally {
          await posthog.shutdown()
        }
      }
    }
  )

  it('allows explicit overrides without reusing a failed remote payload', async () => {
    const [posthog, mocks] = createTestClient('token')
    mocks.fetch.mockResolvedValue({ status: 200, json: async () => ({ flags: { failed } }) })
    await posthog.reloadFeatureFlagsAsync()
    posthog.overrideFeatureFlag({ failed: 'override' })
    const capture = vi.spyOn(posthog, 'capture')
    expect(posthog.getFeatureFlagResult('failed')).toMatchObject({ variant: 'override', payload: null })
    expect(capture.mock.calls[0][1].$feature_flag_error).toBeUndefined()
    posthog.overrideFeatureFlag(null)
    expect(posthog.getFeatureFlagResult('failed', { sendEvent: false })).toBeUndefined()
    posthog.updateFlags({ failed: true }, undefined, { merge: true })
    expect(posthog.getFeatureFlagResult('failed', { sendEvent: false })).toMatchObject({ enabled: true, payload: null })
    await posthog.shutdown()
  })

  it.each([true, false, undefined])(
    'retains successful pairs only on response-wide error refresh (%s)',
    async (errorsWhileComputingFlags) => {
      const [posthog, mocks] = createTestClient('token')
      let flags = { failed: { ...failed, failed: false, variant: 'local', metadata: { payload: '{"old":true}' } } }
      mocks.fetch.mockImplementation(async () => ({
        status: 200,
        json: async () => ({ flags, errorsWhileComputingFlags }),
      }))
      await posthog.reloadFeatureFlagsAsync()
      flags = { failed }
      await posthog.reloadFeatureFlagsAsync()
      const capture = vi.spyOn(posthog, 'capture')
      if (errorsWhileComputingFlags) {
        expect(posthog.getFeatureFlagResult('failed')).toMatchObject({ variant: 'local', payload: { old: true } })
        expect(capture).toHaveBeenCalledWith(
          '$feature_flag_called',
          expect.objectContaining({ $feature_flag_error: 'errors_while_computing_flags' })
        )
      } else {
        expect(posthog.getFeatureFlagResult('failed')).toBeUndefined()
        expect(posthog.getAllFeatureFlags()).toEqual([])
      }
      await posthog.shutdown()
    }
  )
})
