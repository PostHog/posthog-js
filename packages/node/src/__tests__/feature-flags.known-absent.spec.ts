import { PostHog } from '@/entrypoints/index.node'
import { anyFlagsCall, apiImplementation } from './utils'

const mockedFetch = vi.spyOn(globalThis, 'fetch')

function flag(key: string, properties: object[], extra: object = {}): object {
  return {
    id: 1,
    key,
    active: true,
    filters: { groups: [{ properties, rollout_percentage: 100 }], ...extra },
  }
}

function personFilter(operator: string, value: unknown = 'pro', key = 'plan'): object {
  return { key, type: 'person', operator, value }
}

function flagsRequests(): any[] {
  return mockedFetch.mock.calls
    .filter(([url]) => url === anyFlagsCall[0])
    .map(([, init]) => JSON.parse(init!.body as string))
}

describe('known-absent property keys', () => {
  let posthog: PostHog

  vi.useFakeTimers()

  function setup(localFlags: object, decideFlags: object = {}): void {
    mockedFetch.mockImplementation(apiImplementation({ localFlags, decideFlags }))
    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetchRetryCount: 0,
    })
  }

  afterEach(async () => {
    try {
      // Shutdown flushes queued events, so the fetch mock must still be in place.
      await posthog.shutdown()
    } finally {
      mockedFetch.mockReset()
    }
  })

  it.each([
    ['is_not_set', true],
    ['is_set', false],
    ['exact', false],
    ['is_not', true],
    ['icontains', false],
    ['not_icontains', true],
    ['starts_with', false],
    ['not_starts_with', true],
    ['ends_with', false],
    ['not_ends_with', true],
    ['regex', false],
    ['not_regex', true],
    ['gt', false],
    ['semver_neq', false],
    ['is_date_before', false],
  ])('resolves %s on a listed person key locally to %s', async (operator, expected) => {
    const value =
      operator === 'gt'
        ? '10'
        : operator.startsWith('semver')
          ? '1.2.3'
          : operator.startsWith('is_date')
            ? '2025-01-01T10:00:00Z'
            : 'pro'
    setup({ flags: [flag('flag', [personFilter(operator, value)])] })

    expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: ['plan'] })).toBe(expected)
    expect(flagsRequests()).toHaveLength(0)
  })

  it.each([
    ['not_regex', '[', true],
    ['regex', '[', false],
    ['not_regex', '\\p{L}', true],
    ['regex', '\\p{L}', false],
    ['gt', 'not-a-number', false],
    ['lte', 'not-a-number', false],
    ['semver_eq', 'not-a-version', false],
    ['semver_caret', 'not-a-version', false],
    ['is_date_after', 'not-a-date', false],
  ])('resolves %s with unusable value %j on a listed key locally to %s', async (operator, value, expected) => {
    setup({ flags: [flag('flag', [personFilter(operator, value)])] }, { flag: 'remote' })

    const result = await posthog.evaluateFlags('user', {
      flagKeys: ['flag'],
      onlyEvaluateLocally: true,
      personPropertyKeysKnownAbsent: ['plan'],
    })
    expect(result.getFlag('flag')).toBe(expected)
    expect(result.unresolvedFlags).toEqual({})
    expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: ['plan'] })).toBe(expected)
    expect(flagsRequests()).toHaveLength(0)
  })

  it('treats a listed key as absent even when a value is supplied', async () => {
    setup({ flags: [flag('flag', [personFilter('is_not_set', null)])] })

    const options = { personProperties: { plan: 'pro' }, personPropertyKeysKnownAbsent: ['plan'] }
    expect(await posthog.getFeatureFlag('flag', 'user', options)).toBe(true)
    expect(flagsRequests()).toHaveLength(0)
  })

  it('overrides the distinct_id the SDK adds to person properties', async () => {
    setup({ flags: [flag('flag', [personFilter('is_not_set', null, 'distinct_id')])] })

    expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: ['distinct_id'] })).toBe(true)
  })

  it('leaves an omitted key that is not listed inconclusive', async () => {
    setup({ flags: [flag('flag', [personFilter('is_not_set', null)])] }, { flag: 'remote' })

    expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: ['region'] })).toBe('remote')
    expect(flagsRequests()).toHaveLength(1)
  })

  it('ignores listed person-metadata keys', async () => {
    const metadataKey = '__posthog_person_metadata__created_at'
    setup({ flags: [flag('flag', [personFilter('is_not_set', null, metadataKey)])] }, { flag: 'remote' })

    expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: [metadataKey] })).toBe(
      'remote'
    )
    expect(flagsRequests()).toHaveLength(1)
    expect(flagsRequests()[0].person_property_keys_known_absent).toEqual([metadataKey])
  })

  it.each(['not_icontains_multi', 'not_between'])(
    'still falls back for an unsupported %s on a listed key',
    async (operator) => {
      setup({ flags: [flag('flag', [personFilter(operator, ['pro'])])] }, { flag: 'remote' })

      expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: ['plan'] })).toBe('remote')
      expect(flagsRequests()[0].person_property_keys_known_absent).toEqual(['plan'])
    }
  )

  describe('group keys', () => {
    const groupFlags = {
      flags: [
        flag('org-flag', [{ key: 'tier', type: 'group', group_type_index: 0, operator: 'is_not_set', value: null }], {
          aggregation_group_type_index: 0,
        }),
      ],
      group_type_mapping: { '0': 'organization', '1': 'project' },
    }

    it('apply to their own group type, overriding $group_key and supplied values', async () => {
      setup(groupFlags)

      expect(
        await posthog.getFeatureFlag('org-flag', 'user', {
          groups: { organization: 'acme' },
          groupProperties: { organization: { tier: 'gold' } },
          groupPropertyKeysKnownAbsent: { organization: ['tier'] },
        })
      ).toBe(true)
      expect(flagsRequests()).toHaveLength(0)
    })

    it('do not apply to another group type and are sent on fallback', async () => {
      setup(groupFlags, { 'org-flag': 'remote' })

      expect(
        await posthog.getFeatureFlag('org-flag', 'user', {
          groups: { organization: 'acme' },
          groupPropertyKeysKnownAbsent: { project: ['tier'] },
        })
      ).toBe('remote')
      expect(flagsRequests()).toHaveLength(1)
      expect(flagsRequests()[0].group_property_keys_known_absent).toEqual({ project: ['tier'] })
      expect(flagsRequests()[0]).not.toHaveProperty('person_property_keys_known_absent')
    })

    it('do not find an entry for a group type named like an Object.prototype member', async () => {
      setup({
        flags: [
          flag('org-flag', [{ key: 'tier', type: 'group', group_type_index: 0, operator: 'exact', value: 'gold' }], {
            aggregation_group_type_index: 0,
          }),
        ],
        group_type_mapping: { '0': 'constructor' },
      })

      expect(
        await posthog.getFeatureFlag('org-flag', 'user', {
          groups: { constructor: 'acme' },
          groupProperties: { constructor: { tier: 'gold' } },
          groupPropertyKeysKnownAbsent: {},
        })
      ).toBe(true)
      expect(flagsRequests()).toHaveLength(0)
    })

    it('apply in mixed group conditions of a person flag', async () => {
      setup({
        flags: [
          {
            id: 1,
            key: 'mixed',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'tier',
                      type: 'group',
                      group_type_index: 0,
                      operator: 'is_not',
                      value: 'gold',
                    },
                  ],
                  rollout_percentage: 100,
                  aggregation_group_type_index: 0,
                },
              ],
            },
          },
        ],
        group_type_mapping: { '0': 'organization' },
      })

      expect(
        await posthog.getFeatureFlag('mixed', 'user', {
          groups: { organization: 'acme' },
          groupProperties: { organization: { tier: 'gold' } },
          groupPropertyKeysKnownAbsent: { organization: ['tier'] },
        })
      ).toBe(true)
    })
  })

  it.each([
    ['is_not', 'omitted'],
    ['is_not', 'null'],
    ['exact', 'null'],
    ['gt', 'null'],
  ])('leaves %s with a condition value that is %s on a listed key inconclusive', async (operator, valueCase) => {
    const filter: Record<string, unknown> = { key: 'plan', type: 'person', operator }
    if (valueCase === 'null') {
      filter.value = null
    }
    setup({ flags: [flag('flag', [filter])] }, { flag: 'remote' })

    const result = await posthog.evaluateFlags('user', {
      flagKeys: ['flag'],
      onlyEvaluateLocally: true,
      personPropertyKeysKnownAbsent: ['plan'],
    })
    expect(result.getFlag('flag')).toBeUndefined()
    expect(result.unresolvedFlags).toEqual({ flag: 'unsupported_definition' })
    expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: ['plan'] })).toBe('remote')
    expect(flagsRequests()).toHaveLength(1)
    expect(flagsRequests()[0].person_property_keys_known_absent).toEqual(['plan'])
  })

  it.each([
    ['is_not_set', true],
    ['is_set', false],
  ])('resolves %s with a null condition value on a listed key locally to %s', async (operator, expected) => {
    setup({ flags: [flag('flag', [personFilter(operator, null)])] })

    expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: ['plan'] })).toBe(expected)
    expect(flagsRequests()).toHaveLength(0)
  })

  it('applies to dynamic cohort leaves before negation', async () => {
    setup({
      flags: [flag('cohort-flag', [{ key: 'id', type: 'cohort', value: 'c1', operator: 'in' }])],
      cohorts: {
        c1: { type: 'AND', values: [{ ...personFilter('is_set', null), negation: true }] },
      },
    })

    expect(await posthog.getFeatureFlag('cohort-flag', 'user', { personPropertyKeysKnownAbsent: ['plan'] })).toBe(true)
    expect(flagsRequests()).toHaveLength(0)
  })

  it.each([false, true])(
    'still falls back for an unsupported not_between in a dynamic cohort leaf on a listed key (negation: %s)',
    async (negation) => {
      setup(
        {
          flags: [flag('cohort-flag', [{ key: 'id', type: 'cohort', value: 'c1', operator: 'in' }])],
          cohorts: {
            c1: { type: 'AND', values: [{ ...personFilter('not_between', [1, 2]), negation }] },
          },
        },
        { 'cohort-flag': 'remote' }
      )

      const result = await posthog.evaluateFlags('user', {
        flagKeys: ['cohort-flag'],
        onlyEvaluateLocally: true,
        personPropertyKeysKnownAbsent: ['plan'],
      })
      expect(result.getFlag('cohort-flag')).toBeUndefined()
      expect(result.unresolvedFlags).toEqual({ 'cohort-flag': 'unsupported_definition' })
      expect(await posthog.getFeatureFlag('cohort-flag', 'user', { personPropertyKeysKnownAbsent: ['plan'] })).toBe(
        'remote'
      )
      expect(flagsRequests()).toHaveLength(1)
      expect(flagsRequests()[0].person_property_keys_known_absent).toEqual(['plan'])
    }
  )

  it('applies to flag dependencies', async () => {
    setup({
      flags: [
        flag('base', [personFilter('is_not_set', null)]),
        flag('dependent', [
          {
            key: 'base',
            type: 'flag',
            value: true,
            operator: 'flag_evaluates_to',
            dependency_chain: ['base'],
          },
        ]),
      ],
    })

    expect(await posthog.getFeatureFlag('dependent', 'user', { personPropertyKeysKnownAbsent: ['plan'] })).toBe(true)
    expect(flagsRequests()).toHaveLength(0)
  })

  describe('remote /flags body', () => {
    // The flag is inconclusive because of an unrelated missing property.
    const inconclusive = { flags: [flag('flag', [personFilter('exact', 'x', 'email')])] }

    it('includes the listed keys on fallback from getFeatureFlag', async () => {
      setup(inconclusive, { flag: 'remote' })

      expect(
        await posthog.getFeatureFlag('flag', 'user', {
          personPropertyKeysKnownAbsent: ['plan'],
          groupPropertyKeysKnownAbsent: { organization: ['tier'] },
        })
      ).toBe('remote')
      expect(flagsRequests()[0]).toMatchObject({
        person_property_keys_known_absent: ['plan'],
        group_property_keys_known_absent: { organization: ['tier'] },
      })
    })

    it('includes the listed keys on fallback from getAllFlags and evaluateFlags', async () => {
      setup(inconclusive, { flag: 'remote' })

      await posthog.getAllFlags('user', { personPropertyKeysKnownAbsent: ['plan'] })
      await posthog.evaluateFlags('user', { personPropertyKeysKnownAbsent: ['plan'] })
      expect(flagsRequests()).toHaveLength(2)
      for (const body of flagsRequests()) {
        expect(body.person_property_keys_known_absent).toEqual(['plan'])
      }
    })

    it('sends a __proto__ group type as a normal key', async () => {
      setup(inconclusive, { flag: 'remote' })

      await posthog.getFeatureFlag('flag', 'user', {
        groupPropertyKeysKnownAbsent: JSON.parse('{"__proto__": ["tier"]}'),
      })
      const sent = flagsRequests()[0].group_property_keys_known_absent
      expect(Object.keys(sent)).toEqual(['__proto__'])
      expect(sent['__proto__']).toEqual(['tier'])
    })

    it('sends the keys as they were when evaluation started', async () => {
      setup(inconclusive, { flag: 'remote' })
      const personKeys = ['plan']
      const organizationKeys = ['tier']

      const result = posthog.getFeatureFlag('flag', 'user', {
        personPropertyKeysKnownAbsent: personKeys,
        groupPropertyKeysKnownAbsent: { organization: organizationKeys },
      })
      personKeys.push('email')
      organizationKeys.push('size')
      expect(await result).toBe('remote')
      expect(flagsRequests()[0]).toMatchObject({
        person_property_keys_known_absent: ['plan'],
        group_property_keys_known_absent: { organization: ['tier'] },
      })
    })

    it('omits the fields when nothing was listed', async () => {
      setup(inconclusive, { flag: 'remote' })

      await posthog.getFeatureFlag('flag', 'user')
      await posthog.getFeatureFlag('flag', 'user', {
        personPropertyKeysKnownAbsent: [],
        groupPropertyKeysKnownAbsent: { organization: [] },
      })
      expect(flagsRequests()).toHaveLength(2)
      for (const body of flagsRequests()) {
        expect(body).not.toHaveProperty('person_property_keys_known_absent')
        expect(body).not.toHaveProperty('group_property_keys_known_absent')
      }
    })
  })

  describe('1000-key limit', () => {
    const keys = (count: number): string[] => Array.from({ length: count }, () => 'plan')

    it('accepts 1000 keys, counting duplicates', async () => {
      setup({ flags: [flag('flag', [personFilter('is_not_set', null)])] })

      expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: keys(1000) })).toBe(true)
    })

    it('rejects more person keys without a request', async () => {
      setup({ flags: [flag('flag', [personFilter('exact', 'x', 'email')])] }, { flag: 'remote' })

      await expect(
        posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: keys(1001) })
      ).rejects.toThrow('personPropertyKeysKnownAbsent allows at most 1000 keys')
      await expect(posthog.evaluateFlags('user', { personPropertyKeysKnownAbsent: keys(1001) })).rejects.toThrow()
      expect(flagsRequests()).toHaveLength(0)
    })

    it('rejects more keys for one group type without a request', async () => {
      setup({ flags: [flag('flag', [personFilter('exact', 'x', 'email')])] }, { flag: 'remote' })

      await expect(
        posthog.getAllFlags('user', { groupPropertyKeysKnownAbsent: { organization: keys(1001) } })
      ).rejects.toThrow('groupPropertyKeysKnownAbsent allows at most 1000 keys per group type')
      expect(flagsRequests()).toHaveLength(0)
    })
  })
})
