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

    it.each([
      ['a group flag', { aggregation_group_type_index: 0 }, {}],
      ['a mixed group condition', {}, { aggregation_group_type_index: 0 }],
    ])(
      'do not apply to a dynamic cohort in %s, which stays as without known absence',
      async (_name, flagExtra, conditionExtra) => {
        setup(
          {
            flags: [
              {
                id: 1,
                key: 'cohort-flag',
                active: true,
                filters: {
                  groups: [
                    {
                      properties: [{ key: 'id', type: 'cohort', value: 'c1', operator: 'in' }],
                      rollout_percentage: 100,
                      ...conditionExtra,
                    },
                  ],
                  ...flagExtra,
                },
              },
            ],
            cohorts: { c1: { type: 'AND', values: [personFilter('is_not_set', null)] } },
            group_type_mapping: { '0': 'organization' },
          },
          { 'cohort-flag': 'remote' }
        )

        const options = {
          groups: { organization: 'acme' },
          personProperties: { plan: 'pro' },
          groupProperties: { organization: {} },
        }
        for (const listing of [
          { groupPropertyKeysKnownAbsent: { organization: ['plan'] } },
          { personPropertyKeysKnownAbsent: ['plan'] },
        ]) {
          expect(
            await posthog.getFeatureFlag('cohort-flag', 'user', { ...options, ...listing, onlyEvaluateLocally: true })
          ).toBeUndefined()
          expect(await posthog.getFeatureFlag('cohort-flag', 'user', { ...options, ...listing })).toBe('remote')
        }
        expect(flagsRequests()).toHaveLength(2)
      }
    )

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

    describe.each([
      ['a group flag', { aggregation_group_type_index: 0 }, {}],
      ['a mixed group condition', {}, { aggregation_group_type_index: 0 }],
    ])('apply to a group filter without group_type_index in %s', (_name, flagExtra, conditionExtra) => {
      it.each([
        ['exact', 'enterprise', false],
        ['is_not_set', null, true],
      ])('resolving %s locally to %s', async (operator, value, expected) => {
        setup(
          {
            flags: [
              {
                id: 1,
                key: 'legacy-tier',
                active: true,
                filters: {
                  groups: [
                    {
                      properties: [{ key: 'tier', type: 'group', operator, value }],
                      rollout_percentage: 100,
                      ...conditionExtra,
                    },
                  ],
                  ...flagExtra,
                },
              },
            ],
            group_type_mapping: { '0': 'organization', '1': 'project' },
          },
          { 'legacy-tier': 'remote' }
        )

        const result = await posthog.evaluateFlags('user', {
          flagKeys: ['legacy-tier'],
          onlyEvaluateLocally: true,
          groups: { organization: 'acme' },
          groupProperties: { organization: { tier: 'enterprise' } },
          groupPropertyKeysKnownAbsent: { organization: ['tier'] },
        })
        expect(result.getFlag('legacy-tier')).toBe(expected)
        expect(result.unresolvedFlags).toEqual({})
        expect(flagsRequests()).toHaveLength(0)
      })

      it('but not keys listed for another group type', async () => {
        setup({
          flags: [
            {
              id: 1,
              key: 'legacy-tier',
              active: true,
              filters: {
                groups: [
                  {
                    properties: [{ key: 'tier', type: 'group', operator: 'exact', value: 'enterprise' }],
                    rollout_percentage: 100,
                    ...conditionExtra,
                  },
                ],
                ...flagExtra,
              },
            },
          ],
          group_type_mapping: { '0': 'organization', '1': 'project' },
        })

        expect(
          await posthog.getFeatureFlag('legacy-tier', 'user', {
            groups: { organization: 'acme' },
            groupProperties: { organization: { tier: 'enterprise' } },
            groupPropertyKeysKnownAbsent: { project: ['tier'] },
          })
        ).toBe(true)
        expect(flagsRequests()).toHaveLength(0)
      })
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

  describe('flag dependencies evaluate the referenced flag in its own context', () => {
    const dependsOn = (parent: string): object => ({
      key: parent,
      type: 'flag',
      value: true,
      operator: 'flag_evaluates_to',
      dependency_chain: [parent],
    })
    const orgParent = (rolloutPercentage = 100): object => ({
      id: 1,
      key: 'org-parent',
      active: true,
      filters: {
        aggregation_group_type_index: 0,
        groups: [
          {
            properties: [{ key: 'region', type: 'group', group_type_index: 0, operator: 'exact', value: 'us' }],
            rollout_percentage: rolloutPercentage,
          },
        ],
      },
    })
    const personChild = { ...flag('person-child', [dependsOn('org-parent')]), id: 2 }

    async function evaluateLocally(distinctId: string, options: object): Promise<any> {
      return posthog.evaluateFlags(distinctId, {
        flagKeys: ['org-parent', 'person-child', 'person-parent', 'org-child'],
        onlyEvaluateLocally: true,
        ...options,
      })
    }

    it('a person flag depending on a group flag reads the group properties', async () => {
      setup(
        { flags: [orgParent(), personChild], group_type_mapping: { '0': 'organization' } },
        { 'org-parent': 'remote', 'person-child': 'remote' }
      )

      const options = {
        groups: { organization: 'acme' },
        personProperties: { region: 'us' },
        groupProperties: { organization: { region: 'eu' } },
      }
      const result = await evaluateLocally('user', options)
      expect(result.getFlag('org-parent')).toBe(false)
      expect(result.getFlag('person-child')).toBe(false)
      expect(result.unresolvedFlags).toEqual({})
      expect(await posthog.getFeatureFlag('person-child', 'user', options)).toBe(false)
      expect(flagsRequests()).toHaveLength(0)
    })

    it('a group flag dependency without its group resolves to false without fallback', async () => {
      setup(
        { flags: [orgParent(), personChild], group_type_mapping: { '0': 'organization' } },
        { 'org-parent': 'remote', 'person-child': 'remote' }
      )

      const options = {
        personProperties: { region: 'us' },
        groupPropertyKeysKnownAbsent: { organization: ['tier'] },
      }
      const result = await evaluateLocally('user', options)
      expect(result.getFlag('org-parent')).toBe(false)
      expect(result.getFlag('person-child')).toBe(false)
      expect(result.unresolvedFlags).toEqual({})
      expect(await posthog.getFeatureFlag('person-child', 'user', options)).toBe(false)
      expect(flagsRequests()).toHaveLength(0)
    })

    it.each([
      // 'org-parent.acme' hashes into a 50% rollout and 'org-parent.beta' does not.
      ['acme', 'beta', true],
      ['beta', 'acme', false],
    ])(
      'a group flag dependency buckets by the group key %s, not the distinct id %s',
      async (groupKey, distinctId, expected) => {
        setup({ flags: [orgParent(50), personChild], group_type_mapping: { '0': 'organization' } })

        const result = await evaluateLocally(distinctId, {
          groups: { organization: groupKey },
          groupProperties: { organization: { region: 'us' } },
        })
        expect(result.getFlag('org-parent')).toBe(expected)
        expect(result.getFlag('person-child')).toBe(expected)
        expect(result.unresolvedFlags).toEqual({})
      }
    )

    it.each([
      // 'person-parent.user' hashes into a 50% rollout and 'person-parent.acme' does not.
      ['user', 'acme', true],
      ['acme', 'user', false],
    ])(
      'a group flag depending on a person flag reads person properties and buckets by the distinct id %s',
      async (distinctId, groupKey, expected) => {
        setup({
          flags: [
            {
              id: 1,
              key: 'person-parent',
              active: true,
              filters: {
                groups: [
                  {
                    properties: [{ key: 'region', type: 'person', operator: 'exact', value: 'us' }],
                    rollout_percentage: 50,
                  },
                ],
              },
            },
            {
              id: 2,
              key: 'org-child',
              active: true,
              filters: {
                aggregation_group_type_index: 0,
                groups: [{ properties: [dependsOn('person-parent')], rollout_percentage: 100 }],
              },
            },
          ],
          group_type_mapping: { '0': 'organization' },
        })

        const result = await evaluateLocally(distinctId, {
          groups: { organization: groupKey },
          personProperties: { region: 'us' },
          groupProperties: { organization: { region: 'eu' } },
        })
        expect(result.getFlag('person-parent')).toBe(expected)
        expect(result.getFlag('org-child')).toBe(expected)
        expect(result.unresolvedFlags).toEqual({})
      }
    )
  })

  describe('filter type scoping', () => {
    const cohortFlag = flag('cohort-flag', [{ key: 'id', type: 'cohort', value: 'c1', operator: 'in' }])
    const metadataFilter = (operator: string, value: unknown): object => ({
      key: 'created_at',
      type: 'person_metadata',
      operator,
      value,
    })

    it.each([
      ['is_not_set', null],
      ['is_date_before', '2025-01-01T10:00:00Z'],
      ['is_date_after', '2025-01-01T10:00:00Z'],
    ])('a listed person_metadata key with %s does not resolve from the listing', async (operator, value) => {
      setup(
        {
          flags: [flag('flag', [metadataFilter(operator, value)]), cohortFlag],
          cohorts: { c1: { type: 'AND', values: [metadataFilter(operator, value)] } },
        },
        { flag: 'remote', 'cohort-flag': 'remote' }
      )

      for (const key of ['flag', 'cohort-flag']) {
        const result = await posthog.evaluateFlags('user', {
          flagKeys: [key],
          onlyEvaluateLocally: true,
          personPropertyKeysKnownAbsent: ['created_at'],
        })
        expect(result.getFlag(key)).toBeUndefined()
        expect(await posthog.getFeatureFlag(key, 'user', { personPropertyKeysKnownAbsent: ['created_at'] })).toBe(
          'remote'
        )
      }
      expect(flagsRequests()).toHaveLength(2)
    })

    it('a listed person_metadata key resolves from a supplied value, as when it is not listed', async () => {
      const filter = metadataFilter('is_date_before', '2025-01-01T10:00:00Z')
      setup({
        flags: [flag('flag', [filter]), cohortFlag],
        cohorts: { c1: { type: 'AND', values: [filter] } },
      })

      const options = {
        personProperties: { created_at: '2020-01-01T10:00:00Z' },
        personPropertyKeysKnownAbsent: ['created_at'],
      }
      expect(await posthog.getFeatureFlag('flag', 'user', options)).toBe(true)
      expect(await posthog.getFeatureFlag('cohort-flag', 'user', options)).toBe(true)
      expect(flagsRequests()).toHaveLength(0)
    })

    it('a person listing does not apply to a group filter in a person condition', async () => {
      setup(
        {
          flags: [
            flag('flag', [{ key: 'tier', type: 'group', group_type_index: 0, operator: 'is_not_set', value: null }]),
          ],
          group_type_mapping: { '0': 'organization' },
        },
        { flag: 'remote' }
      )

      expect(await posthog.getFeatureFlag('flag', 'user', { personPropertyKeysKnownAbsent: ['tier'] })).toBe('remote')
      expect(flagsRequests()).toHaveLength(1)
    })

    it('a person listing does not apply to a group flag', async () => {
      setup(
        {
          flags: [
            flag(
              'org-flag',
              [{ key: 'tier', type: 'group', group_type_index: 0, operator: 'is_not_set', value: null }],
              {
                aggregation_group_type_index: 0,
              }
            ),
          ],
          group_type_mapping: { '0': 'organization' },
        },
        { 'org-flag': 'remote' }
      )

      expect(
        await posthog.getFeatureFlag('org-flag', 'user', {
          groups: { organization: 'acme' },
          personPropertyKeysKnownAbsent: ['tier'],
        })
      ).toBe('remote')
      expect(flagsRequests()).toHaveLength(1)
    })

    it.each([
      ['a person filter', { key: 'plan', type: 'person', operator: 'is_not_set', value: null }],
      [
        'a group filter of another group type',
        { key: 'plan', type: 'group', group_type_index: 1, operator: 'is_not_set', value: null },
      ],
      ['a person_metadata filter', { key: 'plan', type: 'person_metadata', operator: 'is_not_set', value: null }],
    ])('a group listing does not apply to %s in a group condition', async (_name, filter) => {
      setup(
        {
          flags: [flag('org-flag', [filter], { aggregation_group_type_index: 0 })],
          group_type_mapping: { '0': 'organization', '1': 'project' },
        },
        { 'org-flag': 'remote' }
      )

      expect(
        await posthog.getFeatureFlag('org-flag', 'user', {
          groups: { organization: 'acme' },
          groupPropertyKeysKnownAbsent: { organization: ['plan'] },
        })
      ).toBe('remote')
      expect(flagsRequests()).toHaveLength(1)
    })

    it('a group listing does not apply to a person cohort leaf in a person condition', async () => {
      setup(
        {
          flags: [cohortFlag],
          cohorts: { c1: { type: 'AND', values: [personFilter('is_not_set', null)] } },
          group_type_mapping: { '0': 'organization' },
        },
        { 'cohort-flag': 'remote' }
      )

      expect(
        await posthog.getFeatureFlag('cohort-flag', 'user', {
          groups: { organization: 'acme' },
          groupPropertyKeysKnownAbsent: { organization: ['plan'] },
        })
      ).toBe('remote')
      expect(flagsRequests()).toHaveLength(1)
    })

    it.each([
      [
        'a person flag on a group dependency with a person listing',
        { aggregation_group_type_index: 0 },
        {},
        { key: 'tier', type: 'group', group_type_index: 0, operator: 'is_not_set', value: null },
        { personPropertyKeysKnownAbsent: ['tier'] },
      ],
      [
        'a group flag on a person dependency with a group listing',
        {},
        { aggregation_group_type_index: 0 },
        personFilter('is_not_set', null),
        { groupPropertyKeysKnownAbsent: { organization: ['plan'] } },
      ],
      [
        'a group flag on a dependency of another group type',
        { aggregation_group_type_index: 1 },
        { aggregation_group_type_index: 0 },
        { key: 'tier', type: 'group', group_type_index: 1, operator: 'is_not_set', value: null },
        { groupPropertyKeysKnownAbsent: { organization: ['tier'] } },
      ],
    ])(
      'a dependency does not use the listing of another aggregation: %s',
      async (_name, baseExtra, dependentExtra, baseFilter, listing) => {
        setup(
          {
            flags: [
              flag('base', [baseFilter], baseExtra),
              flag(
                'dependent',
                [{ key: 'base', type: 'flag', value: true, operator: 'flag_evaluates_to', dependency_chain: ['base'] }],
                dependentExtra
              ),
            ],
            group_type_mapping: { '0': 'organization', '1': 'project' },
          },
          { dependent: 'remote' }
        )

        const options = {
          groups: { organization: 'acme', project: 'web' },
          personProperties: { plan: 'pro' },
          groupProperties: { organization: { tier: 'gold' }, project: { tier: 'gold' } },
          ...listing,
        }
        expect(await posthog.getFeatureFlag('dependent', 'user', options)).toBe(false)
        expect(flagsRequests()).toHaveLength(0)
      }
    )
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

    it('skips a group type whose list is undefined', async () => {
      setup(inconclusive, { flag: 'remote' })

      // Plain JavaScript callers can pass an undefined list despite the type.
      const groupPropertyKeysKnownAbsent = { organization: undefined, project: ['tier'] } as any
      expect(await posthog.getFeatureFlag('flag', 'user', { groupPropertyKeysKnownAbsent })).toBe('remote')
      expect(flagsRequests()[0].group_property_keys_known_absent).toEqual({ project: ['tier'] })
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
