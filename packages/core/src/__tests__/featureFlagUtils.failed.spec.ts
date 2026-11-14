import { flagDetailsToResults, getFeatureFlagValue, normalizeFlagsResponse } from '@/featureFlagUtils'
import { FeatureFlagDetail } from '@/types'

const metadata = { id: undefined, version: undefined, description: undefined, payload: undefined }
const detail = (key: string, overrides: Partial<FeatureFlagDetail> = {}): FeatureFlagDetail => ({
  key,
  enabled: false,
  variant: undefined,
  reason: undefined,
  metadata,
  ...overrides,
})

describe('failed detailed flag conversion', () => {
  it.each([true, false, undefined])(
    'omits failed values and payloads with global errors %s',
    (errorsWhileComputingFlags) => {
      const flags = {
        failed: detail('failed', {
          failed: true,
          enabled: true,
          variant: 'placeholder',
          metadata: { ...metadata, payload: '{"remote":true}' },
        }),
        disabled: detail('disabled', { failed: false }),
        healthy: detail('healthy', { enabled: true, metadata: { ...metadata, payload: '{"healthy":true}' } }),
      }
      const result = normalizeFlagsResponse({
        flags,
        errorsWhileComputingFlags,
        featureFlags: { failed: 'mirror' },
        featureFlagPayloads: { failed: 'mirror' },
      })
      expect(result.featureFlags).toEqual({ disabled: false, healthy: true })
      expect(result.featureFlagPayloads).toEqual({ healthy: { healthy: true } })
      expect(getFeatureFlagValue(flags.failed)).toBeUndefined()
      expect(flagDetailsToResults(flags).map(({ key }) => key)).toEqual(['disabled', 'healthy'])
    }
  )

  it('preserves legacy flat false and payloads', () => {
    const result = normalizeFlagsResponse({
      featureFlags: { disabled: false },
      featureFlagPayloads: { disabled: 'false' },
    })
    expect(result.featureFlags).toEqual({ disabled: false })
    expect(result.featureFlagPayloads).toEqual({ disabled: false })
  })
})
