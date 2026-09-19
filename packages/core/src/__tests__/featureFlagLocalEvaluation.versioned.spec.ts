import { describe, expect, test } from 'vitest'
import { InconclusiveMatchError, matchFeatureFlagProperty } from '../featureFlagLocalEvaluation'
import type { FeatureFlagProperty, MatchFeatureFlagPropertyOptions } from '../featureFlagLocalEvaluation'

const rows: [FeatureFlagProperty['value'], unknown, boolean, boolean][] = [
  [false, 'banana', true, false],
  [false, 0, true, false],
  [['true', 'false'], 'true', false, true],
  [['true', 'false'], 'pro', true, false],
  [[], true, true, true],
  [[], [], true, true],
  [true, [true], true, false],
  [false, 'FALSE', true, true],
  [false, null, true, false],
  [false, '', true, false],
  [[], [true, ['TRUE', []]], true, true],
  [[], [true, false], false, false],
  [[], false, false, false],
  [[], 0, false, false],
  [[], 'banana', false, false],
  [[true, 'PRO'], 'TRUE', true, true],
  [[false, 'PRO'], 'banana', false, false],
  [['FREE', 'PRO'], 'pro', true, true],
  ['Ä', 'ä', true, true],
]

describe.each([undefined, 1, 2, 3])('property matching version %s', (propertyMatchingVersion) => {
  const options: MatchFeatureFlagPropertyOptions = { propertyMatchingVersion }
  test.each(rows)('filter %j and property %j', (value, actual, legacy, explicit) => {
    const expected = propertyMatchingVersion === 2 ? explicit : legacy
    expect(matchFeatureFlagProperty({ key: 'key', value }, { key: actual }, options)).toBe(expected)
    expect(matchFeatureFlagProperty({ key: 'key', value, operator: 'is_not' }, { key: actual }, options)).toBe(
      !expected
    )
  })

  test('missing properties remain inconclusive', () => {
    expect(() => matchFeatureFlagProperty({ key: 'key', value: false }, {}, options)).toThrow(InconclusiveMatchError)
  })

  test('numeric spelling ambiguity remains inconclusive', () => {
    expect(() => matchFeatureFlagProperty({ key: 'key', value: [1, 'PRO'] }, { key: '1' }, options)).toThrow(
      InconclusiveMatchError
    )
  })
})
