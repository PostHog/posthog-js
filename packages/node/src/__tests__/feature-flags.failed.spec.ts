import type { FeatureFlagDetail } from '@posthog/core'
import { PostHog } from '@/entrypoints/index.node'
import { waitForPromises } from './utils'

const failed = {
  key: 'failed',
  enabled: true,
  variant: 'placeholder',
  failed: true,
  metadata: { id: 42, version: 3, payload: '{"remote":true}' },
  reason: { code: 'dependency_error' },
}

const localFlags = [true, false, 'blue'].map((value, index) => ({
  id: index,
  key: `local-${index}`,
  name: `local-${index}`,
  active: true,
  filters: {
    groups: [{ properties: [], rollout_percentage: value === false ? 0 : 100 }],
    multivariate: typeof value === 'string' ? { variants: [{ key: value, rollout_percentage: 100 }] } : undefined,
    payloads: { [String(value)]: '{"local":true}' },
  },
}))
const inconclusive = {
  id: 4,
  key: 'failed',
  name: 'failed',
  active: true,
  ensure_experience_continuity: true,
  filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
}

describe('failed Node flag records', () => {
  let posthog: PostHog
  afterEach(async () => {
    await posthog?.shutdown()
    vi.restoreAllMocks()
  })

  function setup(
    errorsWhileComputingFlags: boolean | undefined,
    withLocal = false,
    variantPlaceholder = true,
    typedValue = false
  ): void {
    const flags: Record<string, FeatureFlagDetail> = {
      failed: variantPlaceholder ? failed : { ...failed, enabled: false, variant: undefined },
      disabled: { key: 'disabled', enabled: false, failed: false, metadata: {} },
      ...Object.fromEntries(localFlags.map(({ key }) => [key, { ...failed, key }])),
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url) =>
        ({
          status: 200,
          json: async () =>
            String(url).includes('/flags/definitions')
              ? { flags: [...localFlags, inconclusive], group_type_mapping: {}, cohorts: {} }
              : {
                  flags: typedValue
                    ? Object.fromEntries(
                        Object.entries(flags).map(([key, detail]) => [
                          key,
                          {
                            key,
                            value: detail.variant ?? detail.enabled,
                            failed: detail.failed,
                            reason: detail.reason,
                            metadata: { ...detail.metadata, config_version: 2 },
                          },
                        ])
                      )
                    : flags,
                  errorsWhileComputingFlags,
                },
          text: async () => 'ok',
        }) as Response
    )
    posthog = new PostHog('token', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      featureFlagsRequestMaxRetries: 0,
      ...(withLocal ? { personalApiKey: 'personal-key' } : {}),
    })
  }

  it.each(
    [true, false, undefined].flatMap((errorsWhileComputingFlags) =>
      [true, false].map((variantPlaceholder) => ({ errorsWhileComputingFlags, variantPlaceholder }))
    )
  )('returns no result and tracks both causes (%j)', async ({ errorsWhileComputingFlags, variantPlaceholder }) => {
    setup(errorsWhileComputingFlags, false, variantPlaceholder)
    const capture = vi.spyOn(posthog, 'capture')
    expect(await posthog.getFeatureFlagResult('failed', 'user', { sendFeatureFlagEvents: false })).toBeUndefined()
    expect(capture).not.toHaveBeenCalled()
    expect(await posthog.getFeatureFlagResult('failed', 'user')).toBeUndefined()
    expect(await posthog.getFeatureFlag('failed', 'user')).toBeUndefined()
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $feature_flag_response: undefined,
          $feature_flag_error: errorsWhileComputingFlags
            ? 'errors_while_computing_flags,evaluation_failed'
            : 'evaluation_failed',
          $feature_flag_id: 42,
          $feature_flag_reason: 'dependency_error',
          locally_evaluated: false,
        }),
      })
    )
    expect(await posthog.getFeatureFlagResult('disabled', 'user')).toMatchObject({ enabled: false })
    expect(capture.mock.calls[1][0].properties?.$feature_flag_error).toBe(
      errorsWhileComputingFlags ? 'errors_while_computing_flags' : undefined
    )
    expect(await posthog.getAllFlagsAndPayloads('user')).toEqual({
      featureFlags: { disabled: false },
      featureFlagPayloads: {},
    })
  })

  it.each(
    [true, false, undefined].flatMap((errorsWhileComputingFlags) =>
      [true, false].flatMap((variantPlaceholder) =>
        [true, false].flatMap((withLocal) =>
          [true, false].map((typedValue) => ({ errorsWhileComputingFlags, variantPlaceholder, withLocal, typedValue }))
        )
      )
    )
  )(
    'evaluateFlags excludes failed remote records (%j)',
    async ({ errorsWhileComputingFlags, variantPlaceholder, withLocal, typedValue }) => {
      setup(errorsWhileComputingFlags, withLocal, variantPlaceholder, typedValue)
      if (withLocal) {
        await posthog.featureFlagsPoller!.loadFeatureFlags()
      }
      const localEvaluation = posthog.featureFlagsPoller
        ? vi.spyOn(posthog.featureFlagsPoller, 'getAllFlagsAndPayloads')
        : undefined
      const captured = vi.fn()
      posthog.on('capture', captured)
      const snapshot = await posthog.evaluateFlags('user')

      expect
        .soft(snapshot.keys.sort())
        .toEqual(withLocal ? ['disabled', 'local-0', 'local-1', 'local-2'] : ['disabled'])
      expect.soft(snapshot.getFlag('failed', { sendFeatureFlagEvents: false })).toBeUndefined()
      expect.soft(snapshot.getFlagPayload('failed')).toBeUndefined()
      expect.soft(snapshot.isEnabled('failed', { sendFeatureFlagEvents: false })).toBe(false)
      expect.soft(snapshot.isEnabled('failed', { defaultValue: true })).toBe(true)
      expect(snapshot.getFlag('disabled')).toBe(false)
      expect(snapshot.isEnabled('disabled', { defaultValue: true })).toBe(false)
      expect(snapshot.unresolvedFlags).toEqual(withLocal ? { failed: 'experience_continuity' } : {})

      if (withLocal) {
        expect(snapshot.getFlag('local-0')).toBe(true)
        expect(snapshot.getFlagPayload('local-0')).toEqual({ local: true })
        expect(snapshot.getFlag('local-1')).toBe(false)
        expect(snapshot.getFlag('local-2')).toBe('blue')
        expect(snapshot.getFlagPayload('local-2')).toEqual({ local: true })
        expect(localEvaluation).toHaveBeenCalledTimes(1)
      }
      const flagError = withLocal ? 'evaluation_failed,local_evaluation_inconclusive' : 'evaluation_failed'
      await waitForPromises()
      const failedCalls = captured.mock.calls.filter(
        ([message]) => message.event === '$feature_flag_called' && message.properties.$feature_flag === 'failed'
      )
      expect(failedCalls).toHaveLength(1)
      expect(failedCalls[0][0].properties.$feature_flag_response).toBeUndefined()
      expect(failedCalls[0][0]).toMatchObject({
        event: '$feature_flag_called',
        properties: {
          $feature_flag: 'failed',
          $feature_flag_id: 42,
          $feature_flag_version: 3,
          ...(typedValue
            ? { $feature_flag_config_version: 2, $feature_flag_reason_code: 'dependency_error' }
            : { $feature_flag_reason: 'dependency_error' }),
          $feature_flag_error: errorsWhileComputingFlags ? `errors_while_computing_flags,${flagError}` : flagError,
        },
      })

      posthog.capture({ distinctId: 'user', event: 'snapshot used', flags: snapshot })
      await waitForPromises()
      const [event] = captured.mock.calls
        .map(([message]) => message)
        .filter((message) => message.event === 'snapshot used')
      expect(event).toMatchObject({ properties: { '$feature/disabled': false } })
      expect(event.properties).not.toHaveProperty('$feature/failed')
      expect(event.properties.$active_feature_flags).toEqual(withLocal ? ['local-0', 'local-2'] : undefined)
      expect(
        vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url).includes('/flags/?v=4'))
      ).toHaveLength(1)
    }
  )

  it.each(['only', 'onlyAccessed'] as const)('retains selected failed diagnostics through %s', async (filter) => {
    setup(false, false, true, true)
    const captured = vi.fn()
    posthog.on('capture', captured)
    const snapshot = await posthog.evaluateFlags('user')
    snapshot.getFlag('failed', { sendFeatureFlagEvents: false })
    snapshot.getFlagPayload('local-0')
    const filtered = filter === 'only' ? snapshot.only(['failed']) : snapshot.onlyAccessed()
    expect(captured).not.toHaveBeenCalled()
    expect(filtered.keys).toEqual([])
    expect(filtered.unresolvedFlags).toEqual({})
    expect(filtered.getFlagPayload('failed')).toBeUndefined()
    expect(filtered.isEnabled('failed', { defaultValue: true })).toBe(true)
    expect(filtered.getFlag('failed')).toBeUndefined()
    expect(filtered.getFlag('local-0')).toBeUndefined()
    await waitForPromises()
    expect(captured).toHaveBeenCalledTimes(1)
    expect(captured.mock.calls[0][0].properties.$feature_flag_response).toBeUndefined()
    expect(captured.mock.calls[0][0]).toMatchObject({
      event: '$feature_flag_called',
      properties: {
        $feature_flag: 'failed',
        $feature_flag_error: 'evaluation_failed',
        $feature_flag_id: 42,
        $feature_flag_config_version: 2,
        $feature_flag_reason_code: 'dependency_error',
      },
    })
    expect(filtered._getEventProperties()).toEqual({})
    expect(vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url).includes('/flags/?v=4'))).toHaveLength(
      1
    )
  })

  it.each([true, false, undefined])(
    'preserves successful local true/false/variant pairs with global errors %s',
    async (errorsWhileComputingFlags) => {
      setup(errorsWhileComputingFlags, true)
      await posthog.featureFlagsPoller!.loadFeatureFlags()
      expect(await posthog.getAllFlagsAndPayloads('user')).toEqual({
        featureFlags: { 'local-0': true, 'local-1': false, 'local-2': 'blue', disabled: false },
        featureFlagPayloads: { 'local-0': { local: true }, 'local-2': { local: true } },
      })
      vi.spyOn(posthog.featureFlagsPoller!, 'getAllFlagsAndPayloads').mockResolvedValue({
        response: { 'local-0': true, 'local-1': false, 'local-2': 'blue' },
        payloads: { 'local-0': { local: true }, 'local-1': { local: true }, 'local-2': { local: true } },
        unresolved: {},
        fallbackToFlags: true,
      })
      expect((await posthog.getAllFlagsAndPayloads('user')).featureFlagPayloads).toEqual({
        'local-0': { local: true },
        'local-1': { local: true },
        'local-2': { local: true },
      })
      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          flags: {
            'local-0': { key: 'local-0', enabled: true, variant: 'remote', metadata: { payload: '{"remote":true}' } },
          },
        }),
      } as Response)
      expect(await posthog.getAllFlagsAndPayloads('user')).toMatchObject({
        featureFlags: { 'local-0': 'remote', 'local-1': false, 'local-2': 'blue' },
        featureFlagPayloads: { 'local-0': { remote: true }, 'local-1': { local: true }, 'local-2': { local: true } },
      })
      const capture = vi.spyOn(posthog, 'capture')
      expect(await posthog.getFeatureFlagResult('failed', 'user')).toBeUndefined()
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            $feature_flag_response: undefined,
            $feature_flag_error: errorsWhileComputingFlags
              ? 'errors_while_computing_flags,evaluation_failed'
              : 'evaluation_failed',
          }),
        })
      )
      expect(await posthog.getFeatureFlagResult('local-0', 'user')).toMatchObject({
        enabled: true,
        payload: { local: true },
      })
      expect(capture.mock.calls[1][0].properties?.$feature_flag_error).toBeUndefined()
    }
  )
})
