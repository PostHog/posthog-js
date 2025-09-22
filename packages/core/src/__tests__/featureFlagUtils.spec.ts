import {
  getFlagValuesFromFlags,
  getPayloadsFromFlags,
  getFlagDetailsFromFlagsAndPayloads,
  getFeatureFlagValue,
  normalizeFlagsResponse,
} from '@/featureFlagUtils'
import { PostHogFlagsResponse, FeatureFlagDetail } from '@/types'

describe('featureFlagUtils', () => {
  describe('getFeatureFlagValue', () => {
    it('should return variant if present', () => {
      const flag: FeatureFlagDetail = {
        key: 'test-flag',
        enabled: true,
        variant: 'test-variant',
        reason: undefined,
        metadata: { id: 1, version: undefined, description: undefined, payload: undefined },
      }
      expect(getFeatureFlagValue(flag)).toBe('test-variant')
    })

    it('should return enabled if no variant', () => {
      const flag1: FeatureFlagDetail = {
        key: 'test-flag-1',
        enabled: true,
        variant: undefined,
        reason: undefined,
        metadata: { id: 1, version: undefined, description: undefined, payload: undefined },
      }
      const flag2: FeatureFlagDetail = {
        key: 'test-flag-2',
        enabled: false,
        variant: undefined,
        reason: undefined,
        metadata: { id: 2, version: undefined, description: undefined, payload: undefined },
      }
      expect(getFeatureFlagValue(flag1)).toBe(true)
      expect(getFeatureFlagValue(flag2)).toBe(false)
    })

    it('should return undefined if neither variant nor enabled', () => {
      const flag: FeatureFlagDetail = {
        key: 'test-flag',
        enabled: false,
        variant: undefined,
        reason: undefined,
        metadata: { id: 1, version: undefined, description: undefined, payload: undefined },
      }
      expect(getFeatureFlagValue(flag)).toBe(false)
    })
  })

  describe('getFlagValuesFromFlags', () => {
    it('should extract flag values from flags', () => {
      const flags: Record<string, FeatureFlagDetail> = {
        'flag-1': {
          key: 'flag-1',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: { id: 1, version: undefined, description: undefined, payload: undefined },
        },
        'flag-2': {
          key: 'flag-2',
          enabled: false,
          variant: undefined,
          reason: undefined,
          metadata: { id: 2, version: undefined, description: undefined, payload: undefined },
        },
        'flag-3': {
          key: 'flag-3',
          enabled: true,
          variant: 'test-variant',
          reason: undefined,
          metadata: { id: 3, version: undefined, description: undefined, payload: undefined },
        },
      }

      expect(getFlagValuesFromFlags(flags)).toEqual({
        'flag-1': true,
        'flag-2': false,
        'flag-3': 'test-variant',
      })
    })

    it('should handle empty flags object', () => {
      expect(getFlagValuesFromFlags({})).toEqual({})
    })
  })

  describe('getPayloadsFromFlags', () => {
    it('should extract payloads from enabled flags with metadata', () => {
      const flags: Record<string, FeatureFlagDetail> = {
        'flag-with-object-payload': {
          key: 'flag-with-object-payload',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: { id: 1, version: undefined, description: undefined, payload: '{"key": "value"}' },
        },
        'flag-with-single-item-array-payload': {
          key: 'flag-with-single-item-array-payload',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: { id: 1, version: undefined, description: undefined, payload: '[5]' },
        },
        'flag-with-array-payload': {
          key: 'flag-with-array-payload',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: { id: 1, version: undefined, description: undefined, payload: '[1, 2, 3]' },
        },
        'disabled-flag': {
          key: 'disabled-flag',
          enabled: false,
          variant: undefined,
          reason: undefined,
          metadata: { id: 2, version: undefined, description: undefined, payload: undefined },
        },
        'enabled-flag-no-payload': {
          key: 'enabled-flag-no-payload',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: { id: 3, version: undefined, description: undefined, payload: undefined },
        },
      }

      expect(getPayloadsFromFlags(flags)).toEqual({
        'flag-with-object-payload': { key: 'value' },
        'flag-with-single-item-array-payload': [5],
        'flag-with-array-payload': [1, 2, 3],
      })
    })

    it('should handle empty flags object', () => {
      expect(getPayloadsFromFlags({})).toEqual({})
    })

    it('should handle flags with no payloads', () => {
      const flags: Record<string, FeatureFlagDetail> = {
        'flag-1': {
          key: 'flag-1',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: { id: 1, version: undefined, description: undefined, payload: undefined },
        },
        'flag-2': {
          key: 'flag-2',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: { id: 2, version: undefined, description: undefined, payload: undefined },
        },
      }

      expect(getPayloadsFromFlags(flags)).toEqual({})
    })
  })

  describe('getFlagDetailsFromFlagsAndPayloads', () => {
    it('should convert v1 flags and payloads to flag details', () => {
      const flagsResponse: PostHogFlagsResponse = {
        featureFlags: {
          'flag-1': true,
          'flag-2': 'variant-1',
          'flag-3': false,
        },
        featureFlagPayloads: {
          'flag-1': { key: 'value1' },
          'flag-2': { key: 'value2' },
        },
        flags: {},
        errorsWhileComputingFlags: false,
      }

      const result = getFlagDetailsFromFlagsAndPayloads(flagsResponse)

      expect(result).toEqual({
        'flag-1': {
          key: 'flag-1',
          enabled: true,
          variant: undefined,
          reason: undefined,
          metadata: {
            id: undefined,
            version: undefined,
            payload: '{"key":"value1"}',
            description: undefined,
          },
        },
        'flag-2': {
          key: 'flag-2',
          enabled: true,
          variant: 'variant-1',
          reason: undefined,
          metadata: {
            id: undefined,
            version: undefined,
            payload: '{"key":"value2"}',
            description: undefined,
          },
        },
        'flag-3': {
          key: 'flag-3',
          enabled: false,
          variant: undefined,
          reason: undefined,
          metadata: {
            id: undefined,
            version: undefined,
            payload: undefined,
            description: undefined,
          },
        },
      })
    })

    it('should handle empty flags and payloads', () => {
      const flagsResponse: PostHogFlagsResponse = {
        featureFlags: {},
        featureFlagPayloads: {},
        flags: {},
        errorsWhileComputingFlags: false,
      }

      expect(getFlagDetailsFromFlagsAndPayloads(flagsResponse)).toEqual({})
    })
  })

  describe('normalizeFlagsResponse', () => {
    it('should convert v4 response to v1 format', () => {
      const v4Response: PostHogFlagsResponse = {
        flags: {
          'flag-1': {
            key: 'flag-1',
            enabled: true,
            variant: undefined,
            reason: undefined,
            metadata: {
              id: undefined,
              version: undefined,
              payload: '{"key":"value1"}',
              description: undefined,
            },
          },
          'flag-2': {
            key: 'flag-2',
            enabled: true,
            variant: 'variant-1',
            reason: undefined,
            metadata: {
              id: undefined,
              version: undefined,
              payload: '{"key":"value2"}',
              description: undefined,
            },
          },
          'flag-3': {
            key: 'flag-3',
            enabled: false,
            variant: undefined,
            reason: undefined,
            metadata: {
              id: undefined,
              version: undefined,
              payload: undefined,
              description: undefined,
            },
          },
        },
        errorsWhileComputingFlags: false,
        featureFlags: {},
        featureFlagPayloads: {},
      }

      const result = normalizeFlagsResponse(v4Response)

      expect(result).toEqual({
        featureFlags: {
          'flag-1': true,
          'flag-2': 'variant-1',
          'flag-3': false,
        },
        featureFlagPayloads: {
          'flag-1': { key: 'value1' },
          'flag-2': { key: 'value2' },
        },
        flags: v4Response.flags,
        errorsWhileComputingFlags: false,
      })
    })

    it('should convert v1 response to v4 format', () => {
      const v1Response: Omit<PostHogFlagsResponse, 'flags'> = {
        featureFlags: {
          'flag-1': true,
          'flag-2': 'variant-1',
          'flag-3': false,
        },
        featureFlagPayloads: {
          'flag-1': { key: 'value1' },
          'flag-2': { key: 'value2' },
        },
        errorsWhileComputingFlags: false,
      }

      const result = normalizeFlagsResponse(v1Response)

      expect(result).toEqual({
        featureFlags: {
          'flag-1': true,
          'flag-2': 'variant-1',
          'flag-3': false,
        },
        featureFlagPayloads: {
          'flag-1': { key: 'value1' },
          'flag-2': { key: 'value2' },
        },
        flags: {
          'flag-1': {
            key: 'flag-1',
            enabled: true,
            variant: undefined,
            reason: undefined,
            metadata: {
              id: undefined,
              version: undefined,
              payload: '{"key":"value1"}',
              description: undefined,
            },
          },
          'flag-2': {
            key: 'flag-2',
            enabled: true,
            variant: 'variant-1',
            reason: undefined,
            metadata: {
              id: undefined,
              version: undefined,
              payload: '{"key":"value2"}',
              description: undefined,
            },
          },
          'flag-3': {
            key: 'flag-3',
            enabled: false,
            variant: undefined,
            reason: undefined,
            metadata: {
              id: undefined,
              version: undefined,
              payload: undefined,
              description: undefined,
            },
          },
        },
        errorsWhileComputingFlags: false,
      })
    })

    it('should handle empty flags and payloads', () => {
      const v1Response: Omit<PostHogFlagsResponse, 'flags'> = {
        featureFlags: {},
        featureFlagPayloads: {},
        errorsWhileComputingFlags: false,
      }

      const result = normalizeFlagsResponse(v1Response)

      expect(result).toEqual({
        featureFlags: {},
        featureFlagPayloads: {},
        flags: {},
        errorsWhileComputingFlags: false,
      })
    })

    it('should preserve additional fields', () => {
      const v1Response: Omit<PostHogFlagsResponse, 'flags'> = {
        featureFlags: {
          'flag-1': true,
        },
        featureFlagPayloads: {
          'flag-1': { key: 'value1' },
        },
        errorsWhileComputingFlags: false,
        sessionRecording: true,
        quotaLimited: ['feature_flags'],
        requestId: 'test-request-id',
      }

      const result = normalizeFlagsResponse(v1Response)

      expect(result).toEqual({
        featureFlags: {
          'flag-1': true,
        },
        featureFlagPayloads: {
          'flag-1': { key: 'value1' },
        },
        flags: {
          'flag-1': {
            key: 'flag-1',
            enabled: true,
            variant: undefined,
            reason: undefined,
            metadata: {
              id: undefined,
              version: undefined,
              payload: '{"key":"value1"}',
              description: undefined,
            },
          },
        },
        errorsWhileComputingFlags: false,
        sessionRecording: true,
        quotaLimited: ['feature_flags'],
        requestId: 'test-request-id',
      })
    })
  })
})
