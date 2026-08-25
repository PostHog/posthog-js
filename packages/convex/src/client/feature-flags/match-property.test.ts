import { describe, test, expect } from '@jest/globals'
import { InconclusiveMatchError, matchProperty } from './match-property.js'
import type { FlagProperty } from './types.js'

function prop(operator: string, value: FlagProperty['value']): FlagProperty {
  return { key: 'k', value, operator }
}

describe('matchProperty — numeric comparisons', () => {
  test.each([
    // string override vs numeric value — must compare numerically, not lexicographically.
    { op: 'gt', value: 9, override: '10', expected: true },
    { op: 'gt', value: 100, override: '90', expected: false },
    { op: 'gte', value: 10, override: '10', expected: true },
    { op: 'lt', value: 9, override: '10', expected: false },
    { op: 'lte', value: 10, override: '10', expected: true },
    // number override vs string value
    { op: 'gt', value: '9', override: 10, expected: true },
    { op: 'lt', value: '10', override: 9, expected: true },
    // number-on-number sanity
    { op: 'gt', value: 5, override: 6, expected: true },
    { op: 'lt', value: 5, override: 6, expected: false },
  ])('$op $value vs $override -> $expected', ({ op, value, override, expected }) => {
    expect(matchProperty(prop(op, value), { k: override })).toBe(expected)
  })

  test('falls back to lexicographic comparison when neither side is numeric', () => {
    expect(matchProperty(prop('gt', 'b'), { k: 'c' })).toBe(true)
    expect(matchProperty(prop('lt', 'b'), { k: 'a' })).toBe(true)
  })

  test('non-numeric strings do not produce NaN-leaked comparisons', () => {
    // Pre-fix: `parseFloat('abc') = NaN`, `NaN != null` was true, comparisons silently returned
    // false. Now we fall back to lexicographic comparison so the result is meaningful.
    expect(matchProperty(prop('gt', 'abc'), { k: 'abd' })).toBe(true)
    expect(matchProperty(prop('lt', 'abc'), { k: 'abb' })).toBe(true)
  })
})

describe('matchProperty — is_not_set', () => {
  test('returns true when the property is absent', () => {
    expect(matchProperty({ key: 'missing', value: 'whatever', operator: 'is_not_set' }, {})).toBe(true)
  })

  test('returns false when the property is present', () => {
    expect(matchProperty({ key: 'plan', value: 'whatever', operator: 'is_not_set' }, { plan: 'pro' })).toBe(false)
  })

  test('treats null-valued property as still set (returns false)', () => {
    // `null` counts as present in propertyValues; only genuinely missing keys read as "not set".
    expect(matchProperty({ key: 'plan', value: 'whatever', operator: 'is_not_set' }, { plan: null })).toBe(false)
  })
})

describe('matchProperty — is_set', () => {
  test('returns true when the property is present with a non-null value', () => {
    expect(matchProperty({ key: 'plan', value: '', operator: 'is_set' }, { plan: 'pro' })).toBe(true)
  })

  test('returns true when the property is present with a null value', () => {
    // `is_set` is about key presence, not value. Pre-fix, the null guard short-circuited and
    // returned false here.
    expect(matchProperty({ key: 'plan', value: '', operator: 'is_set' }, { plan: null })).toBe(true)
  })

  test('throws InconclusiveMatchError when the property is absent', () => {
    expect(() => matchProperty({ key: 'plan', value: '', operator: 'is_set' }, {})).toThrow(InconclusiveMatchError)
  })
})

describe('matchProperty — starts_with / ends_with', () => {
  test('starts_with matches case-insensitively', () => {
    expect(matchProperty(prop('starts_with', 'Val'), { k: 'value' })).toBe(true)
    expect(matchProperty(prop('starts_with', 'Val'), { k: 'VALUE' })).toBe(true)
    expect(matchProperty(prop('starts_with', 'Val'), { k: 'vaLue4' })).toBe(true)

    expect(matchProperty(prop('starts_with', 'Val'), { k: 'prevalue' })).toBe(false)
    expect(matchProperty(prop('starts_with', 'Val'), { k: 'Alakazam' })).toBe(false)
    expect(matchProperty(prop('starts_with', 'Val'), { k: 123 })).toBe(false)
  })

  test('starts_with stringifies numeric property values', () => {
    expect(matchProperty(prop('starts_with', '3'), { k: '3' })).toBe(true)
    expect(matchProperty(prop('starts_with', '3'), { k: 323 })).toBe(true)

    expect(matchProperty(prop('starts_with', '3'), { k: 123 })).toBe(false)
    expect(matchProperty(prop('starts_with', '3'), { k: 'val3' })).toBe(false)
  })

  test('not_starts_with negates the match', () => {
    expect(matchProperty(prop('not_starts_with', 'Val'), { k: 'value' })).toBe(false)
    expect(matchProperty(prop('not_starts_with', 'Val'), { k: 'VALUE' })).toBe(false)

    expect(matchProperty(prop('not_starts_with', 'Val'), { k: 'prevalue' })).toBe(true)
    expect(matchProperty(prop('not_starts_with', 'Val'), { k: 'Alakazam' })).toBe(true)
  })

  test('ends_with matches case-insensitively', () => {
    expect(matchProperty(prop('ends_with', 'lUe'), { k: 'value' })).toBe(true)
    expect(matchProperty(prop('ends_with', 'lUe'), { k: 'VALUE' })).toBe(true)
    expect(matchProperty(prop('ends_with', 'lUe'), { k: '343tfvalue' })).toBe(true)

    expect(matchProperty(prop('ends_with', 'lUe'), { k: 'value2' })).toBe(false)
    expect(matchProperty(prop('ends_with', 'lUe'), { k: 'Alakazam' })).toBe(false)
    expect(matchProperty(prop('ends_with', 'lUe'), { k: 123 })).toBe(false)
  })

  test('ends_with stringifies numeric property values', () => {
    expect(matchProperty(prop('ends_with', '3'), { k: '3' })).toBe(true)
    expect(matchProperty(prop('ends_with', '3'), { k: 323 })).toBe(true)
    expect(matchProperty(prop('ends_with', '3'), { k: 13 })).toBe(true)

    expect(matchProperty(prop('ends_with', '3'), { k: 321 })).toBe(false)
    expect(matchProperty(prop('ends_with', '3'), { k: '3val' })).toBe(false)
  })

  test('not_ends_with negates the match', () => {
    expect(matchProperty(prop('not_ends_with', 'lUe'), { k: 'value' })).toBe(false)
    expect(matchProperty(prop('not_ends_with', 'lUe'), { k: 'VALUE' })).toBe(false)

    expect(matchProperty(prop('not_ends_with', 'lUe'), { k: 'value2' })).toBe(true)
    expect(matchProperty(prop('not_ends_with', 'lUe'), { k: 'Alakazam' })).toBe(true)
  })

  test.each(['starts_with', 'not_starts_with', 'ends_with', 'not_ends_with'])(
    '%s throws InconclusiveMatchError when the key is absent',
    (op) => {
      expect(() => matchProperty(prop(op, 'Val'), { other: 'value' })).toThrow(InconclusiveMatchError)
      expect(() => matchProperty(prop(op, 'Val'), {})).toThrow(InconclusiveMatchError)
    }
  )

  test.each(['starts_with', 'not_starts_with', 'ends_with', 'not_ends_with'])(
    '%s returns false when the property value is null or undefined',
    (op) => {
      // The null guard fires before operator dispatch, so the not_ variants are not
      // pure negations here — both directions return false, matching icontains.
      expect(matchProperty(prop(op, 'Val'), { k: null })).toBe(false)
      expect(matchProperty(prop(op, 'Val'), { k: undefined })).toBe(false)
    }
  )
})

describe('matchProperty — SemVer compatibility policy', () => {
  test('preserves legacy leading-zero SemVer matching', () => {
    expect(matchProperty(prop('semver_eq', '01.02.03'), { k: '1.2.3' })).toBe(true)
  })

  test('preserves legacy parseInt-compatible wildcard matching', () => {
    expect(matchProperty(prop('semver_wildcard', '1x.*'), { k: '1.8.0' })).toBe(true)
  })
})

describe('matchProperty — error cases', () => {
  test('throws InconclusiveMatchError when key is absent for non-is_not_set operators', () => {
    expect(() => matchProperty(prop('exact', 'x'), {})).toThrow(InconclusiveMatchError)
  })
})
