import {
  getFeatureFlagHash,
  getFeatureFlagVariant,
  getFeatureFlagVariantLookupTable,
  hashSHA1,
  InconclusiveMatchError,
  matchFeatureFlagProperty,
  parseFeatureFlagSemver,
  relativeDateParseForFeatureFlagMatching,
  resolveFeatureFlagPayload,
} from '../featureFlagLocalEvaluation'
import type { FeatureFlagProperty } from '../featureFlagLocalEvaluation'

const property = (operator: string, value: FeatureFlagProperty['value']): FeatureFlagProperty => ({
  key: 'key',
  operator,
  value,
})

describe('feature flag local evaluation primitives', () => {
  describe('scalar property matching golden cases', () => {
    test.each([
      ['exact', 'PRO', 'pro', true],
      ['exact', ['free', 'PRO'], 'pro', true],
      ['is_not', 'free', 'pro', true],
      ['icontains', 'RO', 'Pro plan', true],
      ['not_icontains', 'enterprise', 'Pro plan', true],
      ['starts_with', 'pro', 'Pro plan', true],
      ['not_starts_with', 'free', 'Pro plan', true],
      ['ends_with', 'PLAN', 'Pro plan', true],
      ['not_ends_with', 'tier', 'Pro plan', true],
      ['regex', '^pro', 'pro plan', true],
      ['not_regex', '^free', 'pro plan', true],
      ['gt', 9, '10', true],
      ['gte', 10, '10', true],
      ['lt', 10, 9, true],
      ['lte', 10, 10, true],
      ['semver_eq', '1.2', 'v1.2.0+build', true],
      ['semver_neq', '1.2.4', '1.2.3', true],
      ['semver_gt', '1.2.3', '1.2.4', true],
      ['semver_gte', '1.2.3', '1.2.3', true],
      ['semver_lt', '1.2.4', '1.2.3', true],
      ['semver_lte', '1.2.3', '1.2.3', true],
      ['semver_tilde', '1.2.3', '1.2.9', true],
      ['semver_caret', '1.2.3', '1.9.0', true],
      ['semver_wildcard', '1.2.*', '1.2.99', true],
    ] as const)('%s target %p and actual %p returns %p', (operator, target, actual, expected) => {
      expect(matchFeatureFlagProperty(property(operator, target), { key: actual })).toBe(expected)
    })

    test.each([
      ['null', null],
      ['undefined', undefined],
      ['false', false],
      ['zero', 0],
      ['empty string', ''],
      ['empty array', []],
      ['empty object', {}],
    ])('treats present %s as set', (_, value) => {
      expect(matchFeatureFlagProperty(property('is_set', ''), { key: value })).toBe(true)
      expect(matchFeatureFlagProperty(property('is_not_set', ''), { key: value })).toBe(false)
    })

    test.each(['is_set', 'is_not_set'])('%s is inconclusive when the property is omitted', (operator) => {
      expect(() => matchFeatureFlagProperty(property(operator, ''), {})).toThrow(InconclusiveMatchError)
    })

    test('preserves null and missing property behavior for exact matching', () => {
      expect(matchFeatureFlagProperty(property('exact', null as never), { key: null })).toBe(false)
      expect(() => matchFeatureFlagProperty(property('exact', 'x'), {})).toThrow(InconclusiveMatchError)
    })

    test('preserves invalid regex and unknown operator behavior', () => {
      expect(matchFeatureFlagProperty(property('regex', '['), { key: 'value' })).toBe(false)
      expect(matchFeatureFlagProperty(property('not_regex', '['), { key: 'value' })).toBe(false)
      expect(() => matchFeatureFlagProperty(property('unknown', 'x'), { key: 'x' })).toThrow(InconclusiveMatchError)
    })

    test('preserves absolute and relative date matching under fixed time', () => {
      jest.setSystemTime(new Date('2025-01-10T12:00:00.000Z'))
      expect(relativeDateParseForFeatureFlagMatching('-2d')).toEqual(new Date('2025-01-08T12:00:00.000Z'))
      expect(matchFeatureFlagProperty(property('is_date_after', '-2d'), { key: '2025-01-09T00:00:00Z' })).toBe(true)
      expect(
        matchFeatureFlagProperty(property('is_date_before', '2025-01-11T00:00:00Z'), {
          key: '2025-01-10T00:00:00Z',
        })
      ).toBe(true)
    })

    test('makes strict and legacy-permissive SemVer parsing an explicit policy', () => {
      expect(() => parseFeatureFlagSemver('01.02.03')).toThrow(InconclusiveMatchError)
      expect(parseFeatureFlagSemver('01.02.03', 'legacy-permissive')).toEqual([1, 2, 3])
      expect(
        matchFeatureFlagProperty(
          property('semver_wildcard', '1x.*'),
          { key: '1.8.0' },
          {
            semverParsingPolicy: 'legacy-permissive',
          }
        )
      ).toBe(true)
      expect(() => matchFeatureFlagProperty(property('semver_wildcard', '1x.*'), { key: '1.8.0' })).toThrow(
        InconclusiveMatchError
      )
    })
  })

  describe('deterministic hashing and variants', () => {
    test.each([
      ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
      ['flag.user', '6f8c733f9f8a78ae53b6ae4ec3c39fd6b7805287'],
    ])('SHA-1(%s)', async (input, expected) => {
      await expect(hashSHA1(input)).resolves.toBe(expected)
    })

    test.each([
      ['flag', 'user', '', 0.4357368498163313],
      ['flag', 'user', 'variant', 0.4727021985667222],
      ['beta-feature', 'distinct-id', '', 0.2299884300760246],
    ])('hashes %s / %s / %s without assignment drift', async (key, bucketingValue, salt, expected) => {
      await expect(getFeatureFlagHash(key, bucketingValue, salt)).resolves.toBe(expected)
    })

    test('constructs exact half-open variant intervals', () => {
      expect(
        getFeatureFlagVariantLookupTable([
          { key: 'a', rollout_percentage: 20 },
          { key: 'b', rollout_percentage: 30 },
          { key: 'c', rollout_percentage: 50 },
        ])
      ).toEqual([
        { key: 'a', valueMin: 0, valueMax: 0.2 },
        { key: 'b', valueMin: 0.2, valueMax: 0.5 },
        { key: 'c', valueMin: 0.5, valueMax: 1 },
      ])
    })

    test('selects a stable variant from the shared hash', async () => {
      await expect(
        getFeatureFlagVariant('flag', 'user', [
          { key: 'left', rollout_percentage: 47 },
          { key: 'right', rollout_percentage: 53 },
        ])
      ).resolves.toBe('right')
    })
  })

  describe('payload resolution', () => {
    test.each([
      ['object', { nested: true }, { nested: true }],
      ['array', '[1,2]', [1, 2]],
      ['number', '0', 0],
      ['boolean', 'false', false],
      ['empty string JSON', '""', ''],
      ['JSON null', 'null', null],
      ['invalid JSON', 'plain text', 'plain text'],
    ])('resolves %s payloads', (_name, configured, expected) => {
      expect(resolveFeatureFlagPayload({ true: configured }, true)).toEqual(expected)
    })

    test('selects variant keys and skips disabled, missing, or raw falsey payloads', () => {
      expect(resolveFeatureFlagPayload({ red: '"payload"' }, 'red')).toBe('payload')
      expect(resolveFeatureFlagPayload({ true: 'value' }, false)).toBeNull()
      expect(resolveFeatureFlagPayload({}, true)).toBeNull()
      expect(resolveFeatureFlagPayload(undefined, true)).toBeNull()
      expect(resolveFeatureFlagPayload({ true: '' }, true)).toBeNull()
      expect(resolveFeatureFlagPayload({ true: 0 }, true)).toBeNull()
      expect(resolveFeatureFlagPayload({ true: false }, true)).toBeNull()
    })
  })
})
