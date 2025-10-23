import { getActiveMatchingSurveys } from '../src/surveys/getActiveMatchingSurveys'
import { Survey, SurveyMatchType, SurveyType } from '@posthog/core'
import { FeatureFlagValue } from '@posthog/core'

// Mock the native-deps module
jest.mock('../src/native-deps', () => ({
  currentDeviceType: 'Mobile',
}))

describe('getActiveMatchingSurveys', () => {
  const mockFlags: Record<string, FeatureFlagValue> = {
    'test-flag': true,
    'test-flag-false': false,
    'variant-flag': 'variant-a',
    'targeting-flag': true,
    'internal-flag': true,
    'variant-flag-true': true,
  }

  const mockSeenSurveys: string[] = ['seen-survey-1', 'seen-survey-2']
  const mockActivatedSurveys = new Set<string>(['activated-survey-1'])

  const createMockSurvey = (overrides: Partial<Survey> = {}): Survey => ({
    id: 'test-survey',
    name: 'Test Survey',
    description: 'Test Description',
    type: SurveyType.Popover,
    questions: [],
    start_date: '2023-01-01T00:00:00Z',
    end_date: undefined,
    ...overrides,
  })

  describe('Basic filtering', () => {
    it('should return surveys that are active (have start_date and no end_date)', () => {
      const surveys = [
        createMockSurvey({ id: 'active-1', start_date: '2023-01-01T00:00:00Z', end_date: undefined }),
        createMockSurvey({ id: 'active-2', start_date: '2023-01-01T00:00:00Z', end_date: undefined }),
        createMockSurvey({ id: 'inactive-1', start_date: undefined, end_date: undefined }),
        createMockSurvey({ id: 'inactive-2', start_date: '2023-01-01T00:00:00Z', end_date: '2023-12-31T23:59:59Z' }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(2)
      expect(result.map((s) => s.id)).toEqual(['active-1', 'active-2'])
    })

    it('should return surveys with no targeting conditions (targeting all users)', () => {
      const surveys = [
        createMockSurvey({
          id: 'all-users-survey',
          linked_flag_key: undefined,
          targeting_flag_key: undefined,
          internal_targeting_flag_key: undefined,
          feature_flag_keys: [],
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('all-users-survey')
    })
  })

  describe('Device type filtering', () => {
    it('should include surveys with no device type conditions', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-device-conditions',
          conditions: {},
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-device-conditions')
    })

    it('should include surveys that match current device type (Mobile)', () => {
      const surveys = [
        createMockSurvey({
          id: 'mobile-survey',
          conditions: {
            deviceTypes: ['Mobile'],
            deviceTypesMatchType: SurveyMatchType.Exact,
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('mobile-survey')
    })

    it('should exclude surveys that do not match current device type', () => {
      const surveys = [
        createMockSurvey({
          id: 'desktop-survey',
          conditions: {
            deviceTypes: ['Desktop'],
            deviceTypesMatchType: SurveyMatchType.Exact,
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should handle icontains match type for device types', () => {
      const surveys = [
        createMockSurvey({
          id: 'mobile-icontains',
          conditions: {
            deviceTypes: ['Mobile', 'Tablet'],
            deviceTypesMatchType: SurveyMatchType.Icontains,
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('mobile-icontains')
    })

    it('should handle not_icontains match type for device types', () => {
      const surveys = [
        createMockSurvey({
          id: 'not-desktop',
          conditions: {
            deviceTypes: ['Desktop'],
            deviceTypesMatchType: SurveyMatchType.NotIcontains,
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('not-desktop')
    })

    it('should handle not_icontains match type when device type is in the list', () => {
      const surveys = [
        createMockSurvey({
          id: 'not-mobile',
          conditions: {
            deviceTypes: ['Mobile'],
            deviceTypesMatchType: SurveyMatchType.NotIcontains,
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })
  })

  describe('URL and selector filtering', () => {
    it('should exclude surveys with URL conditions', () => {
      const surveys = [
        createMockSurvey({
          id: 'url-survey',
          conditions: {
            url: 'https://example.com',
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should exclude surveys with CSS selector conditions', () => {
      const surveys = [
        createMockSurvey({
          id: 'selector-survey',
          conditions: {
            selector: '.my-selector',
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should exclude surveys with both URL and selector conditions', () => {
      const surveys = [
        createMockSurvey({
          id: 'url-and-selector-survey',
          conditions: {
            url: 'https://example.com',
            selector: '.my-selector',
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should include surveys without URL or selector conditions', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-url-selector',
          conditions: {
            deviceTypes: ['Mobile'],
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-url-selector')
    })

    it('should include surveys with empty conditions object', () => {
      const surveys = [
        createMockSurvey({
          id: 'empty-conditions',
          conditions: {},
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('empty-conditions')
    })

    it('should exclude surveys with URL conditions even when all other conditions match', () => {
      const surveys = [
        createMockSurvey({
          id: 'url-with-matching-flags',
          linked_flag_key: 'test-flag',
          conditions: {
            url: 'https://example.com',
            deviceTypes: ['Mobile'],
            deviceTypesMatchType: SurveyMatchType.Exact,
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })
  })

  describe('Seen surveys filtering', () => {
    it('should exclude surveys that have been seen and cannot be activated repeatedly', () => {
      const surveys = [
        createMockSurvey({
          id: 'seen-survey-1',
          conditions: {
            events: {
              values: [],
              repeatedActivation: false,
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should include surveys that have been seen but can be activated repeatedly', () => {
      const surveys = [
        createMockSurvey({
          id: 'seen-survey-1',
          conditions: {
            events: {
              values: [{ name: 'test-event' }],
              repeatedActivation: true,
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('seen-survey-1')
    })

    it('should include surveys that have not been seen', () => {
      const surveys = [
        createMockSurvey({
          id: 'new-survey',
          conditions: {
            events: {
              values: [],
              repeatedActivation: false,
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('new-survey')
    })
  })

  describe('Linked flag filtering', () => {
    it('should include surveys when linked flag is true', () => {
      const surveys = [
        createMockSurvey({
          id: 'linked-flag-true',
          linked_flag_key: 'test-flag',
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('linked-flag-true')
    })

    it('should exclude surveys when linked flag is false', () => {
      const surveys = [
        createMockSurvey({
          id: 'linked-flag-false',
          linked_flag_key: 'test-flag-false',
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should include surveys when linked flag is not set', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-linked-flag',
          linked_flag_key: undefined,
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-linked-flag')
    })
  })

  describe('Linked flag variant filtering', () => {
    it('should include surveys when linked flag variant matches string value', () => {
      const surveys = [
        createMockSurvey({
          id: 'variant-match-string',
          linked_flag_key: 'variant-flag',
          conditions: {
            linkedFlagVariant: 'variant-a',
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('variant-match-string')
    })

    it('should exclude surveys when linked flag variant does not match', () => {
      const surveys = [
        createMockSurvey({
          id: 'variant-no-match',
          linked_flag_key: 'variant-flag',
          conditions: {
            linkedFlagVariant: 'variant-b',
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should include surveys when linked flag variant is "any"', () => {
      const surveys = [
        createMockSurvey({
          id: 'variant-any',
          linked_flag_key: 'variant-flag',
          conditions: {
            linkedFlagVariant: 'any',
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('variant-any')
    })

    it('should include surveys when no linked flag is set but variant is specified', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-flag-with-variant',
          linked_flag_key: undefined,
          conditions: {
            linkedFlagVariant: 'variant-a',
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-flag-with-variant')
    })
  })

  describe('Targeting flag filtering', () => {
    it('should include surveys when targeting flag is true', () => {
      const surveys = [
        createMockSurvey({
          id: 'targeting-flag-true',
          targeting_flag_key: 'targeting-flag',
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('targeting-flag-true')
    })

    it('should exclude surveys when targeting flag is false', () => {
      const surveys = [
        createMockSurvey({
          id: 'targeting-flag-false',
          targeting_flag_key: 'test-flag-false',
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should include surveys when targeting flag is not set', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-targeting-flag',
          targeting_flag_key: undefined,
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-targeting-flag')
    })
  })

  describe('Event-based targeting filtering', () => {
    it('should include surveys with events when they are in activated surveys', () => {
      const surveys = [
        createMockSurvey({
          id: 'activated-survey-1',
          conditions: {
            events: {
              values: [{ name: 'test-event' }],
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('activated-survey-1')
    })

    it('should include surveys with events when they are in activated surveys', () => {
      const surveys = [
        createMockSurvey({
          id: 'activated-survey-1',
          conditions: {
            events: {
              values: [{ name: 'test-event' }],
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('activated-survey-1')
    })

    it('should include surveys without events regardless of activated surveys', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-events-survey',
          conditions: {
            events: {
              values: [],
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-events-survey')
    })
  })

  describe('Internal targeting flag filtering', () => {
    it('should include surveys when internal targeting flag is true and cannot be activated repeatedly', () => {
      const surveys = [
        createMockSurvey({
          id: 'internal-flag-true',
          internal_targeting_flag_key: 'internal-flag',
          conditions: {
            events: {
              values: [],
              repeatedActivation: false,
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('internal-flag-true')
    })

    it('should exclude surveys when internal targeting flag is false and cannot be activated repeatedly', () => {
      const surveys = [
        createMockSurvey({
          id: 'internal-flag-false',
          internal_targeting_flag_key: 'test-flag-false',
          conditions: {
            events: {
              values: [],
              repeatedActivation: false,
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should include surveys when internal targeting flag is not set and cannot be activated repeatedly', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-internal-flag',
          internal_targeting_flag_key: undefined,
          conditions: {
            events: {
              values: [],
              repeatedActivation: false,
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-internal-flag')
    })
  })

  describe('Feature flag keys filtering', () => {
    it('should include surveys when all feature flags are true', () => {
      const surveys = [
        createMockSurvey({
          id: 'all-flags-true',
          feature_flag_keys: [
            { key: 'flag1', value: 'test-flag' },
            { key: 'flag2', value: 'targeting-flag' },
          ],
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('all-flags-true')
    })

    it('should exclude surveys when any feature flag is false', () => {
      const surveys = [
        createMockSurvey({
          id: 'one-flag-false',
          feature_flag_keys: [
            { key: 'flag1', value: 'test-flag' },
            { key: 'flag2', value: 'test-flag-false' },
          ],
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should include surveys when feature flag keys are empty', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-feature-flags',
          feature_flag_keys: [],
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-feature-flags')
    })

    it('should include surveys when feature flag keys are not set', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-feature-flags-undefined',
          feature_flag_keys: undefined,
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-feature-flags-undefined')
    })

    it('should handle feature flags with missing key or value', () => {
      const surveys = [
        createMockSurvey({
          id: 'missing-key-value',
          feature_flag_keys: [
            { key: '', value: 'test-flag' },
            { key: 'flag2', value: '' },
            { key: 'flag3', value: undefined },
          ],
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('missing-key-value')
    })
  })

  describe('Complex combinations', () => {
    it('should exclude surveys that fail any condition', () => {
      const surveys = [
        createMockSurvey({
          id: 'complex-fail',
          linked_flag_key: 'test-flag',
          targeting_flag_key: 'test-flag-false', // This will fail
          conditions: {
            deviceTypes: ['Mobile'],
            deviceTypesMatchType: SurveyMatchType.Exact,
            linkedFlagVariant: 'any',
            events: {
              values: [{ name: 'test-event' }],
              repeatedActivation: true,
            },
          },
          feature_flag_keys: [{ key: 'flag1', value: 'test-flag' }],
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should handle multiple surveys with different conditions', () => {
      const surveys = [
        createMockSurvey({
          id: 'survey-1',
          linked_flag_key: 'test-flag',
          conditions: {
            deviceTypes: ['Mobile'],
            deviceTypesMatchType: SurveyMatchType.Exact,
          },
        }),
        createMockSurvey({
          id: 'survey-2',
          linked_flag_key: 'test-flag-false', // Will be excluded
          conditions: {
            deviceTypes: ['Mobile'],
            deviceTypesMatchType: SurveyMatchType.Exact,
          },
        }),
        createMockSurvey({
          id: 'survey-3',
          linked_flag_key: 'test-flag',
          conditions: {
            deviceTypes: ['Desktop'], // Will be excluded
            deviceTypesMatchType: SurveyMatchType.Exact,
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('survey-1')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty surveys array', () => {
      const result = getActiveMatchingSurveys([], mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(0)
    })

    it('should handle empty flags object', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-flags-survey',
          linked_flag_key: undefined,
          targeting_flag_key: undefined,
          internal_targeting_flag_key: undefined,
          feature_flag_keys: [],
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, {}, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-flags-survey')
    })

    it('should handle empty seen surveys array', () => {
      const surveys = [
        createMockSurvey({
          id: 'new-survey',
          conditions: {
            events: {
              values: [],
              repeatedActivation: false,
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, [], mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('new-survey')
    })

    it('should include surveys without events even with empty activated surveys set', () => {
      const surveys = [
        createMockSurvey({
          id: 'no-events-survey',
          conditions: {
            events: {
              values: [],
            },
          },
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, new Set())

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('no-events-survey')
    })

    it('should handle surveys with null/undefined conditions', () => {
      const surveys = [
        createMockSurvey({
          id: 'null-conditions',
          conditions: null as any,
        }),
      ]

      const result = getActiveMatchingSurveys(surveys, mockFlags, mockSeenSurveys, mockActivatedSurveys)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('null-conditions')
    })
  })
})
