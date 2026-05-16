import { describe, test, expect } from '@jest/globals'
import { LocalFeatureFlagEvaluator } from './evaluator.js'
import type { FlagDefinitions, PostHogFeatureFlag } from './types.js'

function definitions(flags: PostHogFeatureFlag[], extra: Partial<FlagDefinitions> = {}): FlagDefinitions {
  return {
    flags,
    groupTypeMapping: extra.groupTypeMapping ?? {},
    cohorts: extra.cohorts ?? {},
  }
}

function makeFlag(key: string, overrides: Partial<PostHogFeatureFlag> = {}): PostHogFeatureFlag {
  return {
    id: 1,
    name: key,
    key,
    deleted: false,
    active: true,
    rollout_percentage: null,
    ensure_experience_continuity: false,
    experiment_set: [],
    filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
    ...overrides,
  }
}

describe('LocalFeatureFlagEvaluator', () => {
  test('returns undefined for unknown flag keys', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(definitions([]))
    expect(await evaluator.getFeatureFlag('missing', 'user')).toBeUndefined()
  })

  test('returns false for inactive flags', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(definitions([makeFlag('off', { active: false })]))
    expect(await evaluator.getFeatureFlag('off', 'user')).toBe(false)
  })

  test('returns true for fully-rolled-out boolean flag', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(definitions([makeFlag('on')]))
    expect(await evaluator.getFeatureFlag('on', 'user')).toBe(true)
  })

  test('matches person properties (exact)', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([
        makeFlag('pp-flag', {
          filters: {
            groups: [
              {
                properties: [{ key: 'plan', value: 'pro', operator: 'exact', type: 'person' }],
                rollout_percentage: 100,
              },
            ],
          },
        }),
      ])
    )
    expect(await evaluator.getFeatureFlag('pp-flag', 'user', {}, { plan: 'pro' })).toBe(true)
    expect(await evaluator.getFeatureFlag('pp-flag', 'user', {}, { plan: 'free' })).toBe(false)
  })

  test('returns variant key for multivariate flags', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([
        makeFlag('mv', {
          filters: {
            groups: [{ properties: [], rollout_percentage: 100, variant: 'pink' }],
            multivariate: {
              variants: [
                { key: 'pink', rollout_percentage: 100 },
                { key: 'blue', rollout_percentage: 0 },
              ],
            },
          },
        }),
      ])
    )
    expect(await evaluator.getFeatureFlag('mv', 'user')).toBe('pink')
  })

  test('returns undefined when flag requires experience continuity', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([makeFlag('continuity', { ensure_experience_continuity: true })])
    )
    expect(await evaluator.getFeatureFlag('continuity', 'user')).toBeUndefined()
  })

  test('respects rollout percentages deterministically', async () => {
    // 0% rollout — never matches.
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([makeFlag('rollout-0', { filters: { groups: [{ properties: [], rollout_percentage: 0 }] } })])
    )
    expect(await evaluator.getFeatureFlag('rollout-0', 'user-123')).toBe(false)
  })

  test('hashing is stable across users — same input yields same output', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([makeFlag('half', { filters: { groups: [{ properties: [], rollout_percentage: 50 }] } })])
    )
    const a = await evaluator.getFeatureFlag('half', 'stable-distinct-id')
    const b = await evaluator.getFeatureFlag('half', 'stable-distinct-id')
    expect(a).toBe(b)
  })

  test('returns payload for matching flag value', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([
        makeFlag('with-payload', {
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
            payloads: { true: JSON.stringify({ feature: 'x' }) },
          },
        }),
      ])
    )
    expect(await evaluator.getFeatureFlagPayload('with-payload', 'user', undefined)).toEqual({ feature: 'x' })
  })

  test('getFeatureFlagPayload honours matchValue without re-evaluating', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([
        makeFlag('mv', {
          filters: {
            groups: [{ properties: [], rollout_percentage: 0 }],
            multivariate: { variants: [{ key: 'red', rollout_percentage: 100 }] },
            payloads: { red: 'red-payload' },
          },
        }),
      ])
    )
    expect(await evaluator.getFeatureFlagPayload('mv', 'user', 'red')).toBe('red-payload')
  })

  test('getAllFlagsAndPayloads returns all flags', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([
        makeFlag('a'),
        makeFlag('b', { active: false }),
        makeFlag('c', {
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
            payloads: { true: JSON.stringify({ k: 'v' }) },
          },
        }),
      ])
    )
    const result = await evaluator.getAllFlagsAndPayloads('user')
    expect(result.featureFlags).toEqual({ a: true, b: false, c: true })
    expect(result.featureFlagPayloads).toEqual({ c: { k: 'v' } })
  })

  test('getAllFlagsAndPayloads filters by flagKeys', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([makeFlag('a'), makeFlag('b'), makeFlag('c')])
    )
    const result = await evaluator.getAllFlagsAndPayloads('user', {}, {}, {}, ['a', 'c'])
    expect(Object.keys(result.featureFlags).sort()).toEqual(['a', 'c'])
  })

  test('group flag returns false when group not provided', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions([makeFlag('grp', { filters: { aggregation_group_type_index: 0, groups: [{ properties: [], rollout_percentage: 100 }] } })], {
        groupTypeMapping: { '0': 'organization' },
      })
    )
    expect(await evaluator.getFeatureFlag('grp', 'user', {})).toBe(false)
  })

  test('group flag matches on group properties', async () => {
    const evaluator = new LocalFeatureFlagEvaluator(
      definitions(
        [
          makeFlag('grp', {
            filters: {
              aggregation_group_type_index: 0,
              groups: [
                {
                  properties: [{ key: 'plan', value: 'enterprise', operator: 'exact', type: 'group' }],
                  rollout_percentage: 100,
                },
              ],
            },
          }),
        ],
        { groupTypeMapping: { '0': 'organization' } }
      )
    )
    const matched = await evaluator.getFeatureFlag(
      'grp',
      'user',
      { organization: 'acme' },
      {},
      { organization: { plan: 'enterprise' } }
    )
    expect(matched).toBe(true)
  })
})
