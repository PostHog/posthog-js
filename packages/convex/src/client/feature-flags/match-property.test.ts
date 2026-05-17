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

describe('matchProperty — error cases', () => {
  test('throws InconclusiveMatchError when key is absent for non-is_not_set operators', () => {
    expect(() => matchProperty(prop('exact', 'x'), {})).toThrow(InconclusiveMatchError)
  })
})
