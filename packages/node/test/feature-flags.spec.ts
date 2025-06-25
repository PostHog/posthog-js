import { PostHogOptions } from '../src/types'
import { PostHog } from '../src/entrypoints/index.node'
import {
  matchProperty,
  InconclusiveMatchError,
  relativeDateParseForFeatureFlagMatching,
} from '../src/extensions/feature-flags/feature-flags'
import { anyFlagsCall, anyLocalEvalCall, apiImplementation } from './test-utils'
import { waitForPromises } from 'posthog-core/test/test-utils/test-utils'

jest.spyOn(console, 'debug').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const posthogImmediateResolveOptions: PostHogOptions = {
  fetchRetryCount: 0,
}

describe('local evaluation', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  afterEach(async () => {
    // ensure clean shutdown & no test interdependencies
    await posthog.shutdown()
  })

  it('evaluates person properties with undefined property values', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'person-flag',
          active: true,
          filters: {
            groups: [
              {
                variant: null,
                properties: [
                  {
                    key: 'latestBuildVersion',
                    type: 'person',
                    value: '.+',
                    operator: 'regex',
                  },
                  {
                    key: 'latestBuildVersionMajor',
                    type: 'person',
                    value: '23',
                    operator: 'gt',
                  },
                  {
                    key: 'latestBuildVersionMinor',
                    type: 'person',
                    value: '31',
                    operator: 'gt',
                  },
                  {
                    key: 'latestBuildVersionPatch',
                    type: 'person',
                    value: '0',
                    operator: 'gt',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('person-flag', 'some-distinct-id', {
        personProperties: {
          latestBuildVersion: undefined,
          latestBuildVersionMajor: undefined,
          latestBuildVersionMinor: undefined,
          latestBuildVersionPatch: undefined,
        } as unknown as Record<string, string>,
      })
    ).toEqual(false)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })

  it('evaluates person properties', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'person-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'region',
                    operator: 'exact',
                    value: ['USA'],
                    type: 'person',
                  },
                ],
                rollout_percentage: null,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('person-flag', 'some-distinct-id', { personProperties: { region: 'USA' } })
    ).toEqual(true)
    expect(
      await posthog.getFeatureFlag('person-flag', 'some-distinct-id', { personProperties: { region: 'Canada' } })
    ).toEqual(false)
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })

  it('evaluates group properties', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'group-flag',
          active: true,
          filters: {
            aggregation_group_type_index: 0,
            groups: [
              {
                properties: [
                  {
                    group_type_index: 0,
                    key: 'name',
                    operator: 'exact',
                    value: ['Project Name 1'],
                    type: 'group',
                  },
                ],
                rollout_percentage: 35,
              },
            ],
          },
        },
      ],
      group_type_mapping: { '0': 'company', '1': 'project' },
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // # groups not passed in, hence false
    expect(
      await posthog.getFeatureFlag('group-flag', 'some-distinct-id', {
        groupProperties: { company: { name: 'Project Name 1' } },
      })
    ).toEqual(false)
    expect(
      await posthog.getFeatureFlag('group-flag', 'some-distinct-2', {
        groupProperties: { company: { name: 'Project Name 2' } },
      })
    ).toEqual(false)

    // # this is good
    expect(
      await posthog.getFeatureFlag('group-flag', 'some-distinct-2', {
        groups: { company: 'amazon_without_rollout' },
        groupProperties: { company: { name: 'Project Name 1' } },
      })
    ).toEqual(true)

    // # rollout % not met
    expect(
      await posthog.getFeatureFlag('group-flag', 'some-distinct-2', {
        groups: { company: 'amazon' },
        groupProperties: { company: { name: 'Project Name 1' } },
      })
    ).toEqual(false)

    // # property mismatch
    expect(
      await posthog.getFeatureFlag('group-flag', 'some-distinct-2', {
        groups: { company: 'amazon_without_rollout' },
        groupProperties: { company: { name: 'Project Name 2' } },
      })
    ).toEqual(false)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    // flags not called
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('evaluates group properties and falls back to flags when group_type_mappings not present', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'group-flag',
          active: true,
          filters: {
            aggregation_group_type_index: 0,
            groups: [
              {
                properties: [
                  {
                    group_type_index: 0,
                    key: 'name',
                    operator: 'exact',
                    value: ['Project Name 1'],
                    type: 'group',
                  },
                ],
                rollout_percentage: 35,
              },
            ],
          },
        },
      ],
      //   "group_type_mapping": {"0": "company", "1": "project"}
    }
    mockedFetch.mockImplementation(
      apiImplementation({ localFlags: flags, decideFlags: { 'group-flag': 'flags-fallback-value' } })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })
    // # group_type_mappings not present, so fallback to `/flags`
    expect(
      await posthog.getFeatureFlag('group-flag', 'some-distinct-2', {
        groupProperties: {
          company: { name: 'Project Name 1' },
        },
      })
    ).toEqual('flags-fallback-value')
  })

  it('evaluates flag with complex definition', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'complex-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'region',
                    operator: 'exact',
                    value: ['USA'],
                    type: 'person',
                  },
                  {
                    key: 'name',
                    operator: 'exact',
                    value: ['Aloha'],
                    type: 'person',
                  },
                ],
                rollout_percentage: undefined,
              },
              {
                properties: [
                  {
                    key: 'email',
                    operator: 'exact',
                    value: ['a@b.com', 'b@c.com'],
                    type: 'person',
                  },
                ],
                rollout_percentage: 30,
              },
              {
                properties: [
                  {
                    key: 'doesnt_matter',
                    operator: 'exact',
                    value: ['1', '2'],
                    type: 'person',
                  },
                ],
                rollout_percentage: 0,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({ localFlags: flags, decideFlags: { 'complex-flag': 'flags-fallback-value' } })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id', {
        personProperties: { region: 'USA', name: 'Aloha' },
      })
    ).toEqual(true)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    // # this distinctIDs hash is < rollout %
    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id_within_rollout?', {
        personProperties: { region: 'USA', email: 'a@b.com' },
      })
    ).toEqual(true)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    // # will fall back on `/flags`, as all properties present for second group, but that group resolves to false
    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id_outside_rollout?', {
        personProperties: { region: 'USA', email: 'a@b.com' },
      })
    ).toEqual('flags-fallback-value')
    expect(mockedFetch).toHaveBeenCalledWith(
      'http://example.com/flags/?v=2&config=true',
      expect.objectContaining({
        body: JSON.stringify({
          token: 'TEST_API_KEY',
          distinct_id: 'some-distinct-id_outside_rollout?',
          groups: {},
          person_properties: {
            distinct_id: 'some-distinct-id_outside_rollout?',
            region: 'USA',
            email: 'a@b.com',
          },
          group_properties: {},
          geoip_disable: true,
          flag_keys_to_evaluate: ['complex-flag'],
        }),
      })
    )
    mockedFetch.mockClear()

    // # same as above
    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id', { personProperties: { doesnt_matter: '1' } })
    ).toEqual('flags-fallback-value')
    expect(mockedFetch).toHaveBeenCalledWith(
      'http://example.com/flags/?v=2&config=true',
      expect.objectContaining({
        body: JSON.stringify({
          token: 'TEST_API_KEY',
          distinct_id: 'some-distinct-id',
          groups: {},
          person_properties: { distinct_id: 'some-distinct-id', doesnt_matter: '1' },
          group_properties: {},
          geoip_disable: true,
          flag_keys_to_evaluate: ['complex-flag'],
        }),
      })
    )
    mockedFetch.mockClear()

    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id', { personProperties: { region: 'USA' } })
    ).toEqual('flags-fallback-value')
    expect(mockedFetch).toHaveBeenCalledTimes(1) // TODO: Check this
    mockedFetch.mockClear()

    // # won't need to fallback when all values are present, and resolves to False
    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id_outside_rollout?', {
        personProperties: { region: 'USA', email: 'a@b.com', name: 'X', doesnt_matter: '1' },
      })
    ).toEqual(false)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('falls back to flags', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: 'id', value: 98, operator: undefined, type: 'cohort' }],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'beta-feature2',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'region',
                    operator: 'exact',
                    value: ['USA'],
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'alakazam', 'beta-feature2': 'alakazam2' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // # beta-feature fallbacks to flags because property type is unknown
    expect(await posthog.getFeatureFlag('beta-feature', 'some-distinct-id')).toEqual('alakazam')
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
    mockedFetch.mockClear()

    // # beta-feature2 fallbacks to flags because region property not given with call
    expect(await posthog.getFeatureFlag('beta-feature2', 'some-distinct-id')).toEqual('alakazam2')
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('dont fall back to flags when local evaluation is set', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: 'id', value: 98, operator: undefined, type: 'cohort' }],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'beta-feature2',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'region',
                    operator: 'exact',
                    value: ['USA'],
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'alakazam', 'beta-feature2': 'alakazam2' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // # beta-feature should fallback to flags because property type is unknown
    // # but doesn't because only_evaluate_locally is true
    expect(await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', { onlyEvaluateLocally: true })).toEqual(
      undefined
    )
    expect(await posthog.isFeatureEnabled('beta-feature', 'some-distinct-id', { onlyEvaluateLocally: true })).toEqual(
      undefined
    )
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    // # beta-feature2 should fallback to flags because region property not given with call
    // # but doesn't because only_evaluate_locally is true
    expect(await posthog.getFeatureFlag('beta-feature2', 'some-distinct-id', { onlyEvaluateLocally: true })).toEqual(
      undefined
    )
    expect(await posthog.isFeatureEnabled('beta-feature2', 'some-distinct-id', { onlyEvaluateLocally: true })).toEqual(
      undefined
    )
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it("doesn't return undefined when flag is evaluated successfully", async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags, decideFlags: {} }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // # beta-feature resolves to False
    expect(await posthog.getFeatureFlag('beta-feature', 'some-distinct-id')).toEqual(false)
    expect(await posthog.isFeatureEnabled('beta-feature', 'some-distinct-id')).toEqual(false)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    // # beta-feature2 falls back to flags, and whatever flags returns is the value
    expect(await posthog.getFeatureFlag('beta-feature2', 'some-distinct-id')).toEqual(undefined)
    expect(await posthog.isFeatureEnabled('beta-feature2', 'some-distinct-id')).toEqual(undefined)
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('experience continuity flags are not evaluated locally', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          ensure_experience_continuity: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({ localFlags: flags, decideFlags: { 'beta-feature': 'flags-fallback-value' } })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // # beta-feature2 falls back to flags, which on error returns default
    expect(await posthog.getFeatureFlag('beta-feature', 'some-distinct-id')).toEqual('flags-fallback-value')
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('get all flags with fallback', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'disabled-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
          },
        },
        {
          id: 3,
          name: 'Beta Feature',
          key: 'beta-feature2',
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: 'country', value: 'US' }],
                rollout_percentage: 0,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // # beta-feature value overridden by /flags
    expect(await posthog.getAllFlags('distinct-id')).toEqual({
      'beta-feature': 'variant-1',
      'beta-feature2': 'variant-2',
      'disabled-feature': false,
    })
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
    mockedFetch.mockClear()
  })

  it('get all payloads with fallback', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
            payloads: {
              true: 'some-payload',
            },
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'disabled-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
            payloads: {
              true: 'another-payload',
            },
          },
        },
        {
          id: 3,
          name: 'Beta Feature',
          key: 'beta-feature2',
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: 'country', value: 'US' }],
                rollout_percentage: 0,
              },
            ],
            payloads: {
              true: 'payload-3',
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
        flagsPayloads: { 'beta-feature': 100, 'beta-feature2': 300 },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // # beta-feature value overridden by /flags
    expect((await posthog.getAllFlagsAndPayloads('distinct-id')).featureFlagPayloads).toEqual({
      'beta-feature': 100,
      'beta-feature2': 300,
    })
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
    mockedFetch.mockClear()
  })

  it('get all flags with fallback but only_locally_evaluated set', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'disabled-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
          },
        },
        {
          id: 3,
          name: 'Beta Feature',
          key: 'beta-feature2',
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: 'country', value: 'US' }],
                rollout_percentage: 0,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // # beta-feature2 has no value
    expect(await posthog.getAllFlags('distinct-id', { onlyEvaluateLocally: true })).toEqual({
      'beta-feature': true,
      'disabled-feature': false,
    })
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('get all payloads with fallback but only_evaluate_locally set', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
            payloads: {
              true: 'some-payload',
            },
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'disabled-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
            payloads: {
              true: 'another-payload',
            },
          },
        },
        {
          id: 3,
          name: 'Beta Feature',
          key: 'beta-feature2',
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: 'country', value: 'US' }],
                rollout_percentage: 0,
              },
            ],
            payloads: {
              true: 'payload-3',
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
        flagsPayloads: { 'beta-feature': 100, 'beta-feature2': 300 },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      (await posthog.getAllFlagsAndPayloads('distinct-id', { onlyEvaluateLocally: true })).featureFlagPayloads
    ).toEqual({
      'beta-feature': 'some-payload',
    })
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('get all flags with fallback, with no local flags', async () => {
    const flags = {
      flags: [],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(await posthog.getAllFlags('distinct-id')).toEqual({
      'beta-feature': 'variant-1',
      'beta-feature2': 'variant-2',
    })
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
    mockedFetch.mockClear()
  })

  it('get all payloads with fallback, with no local payloads', async () => {
    const flags = {
      flags: [],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
        flagsPayloads: { 'beta-feature': 100, 'beta-feature2': 300 },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect((await posthog.getAllFlagsAndPayloads('distinct-id')).featureFlagPayloads).toEqual({
      'beta-feature': 100,
      'beta-feature2': 300,
    })
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
    mockedFetch.mockClear()
  })

  it('get all flags with no fallback', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'disabled-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(await posthog.getAllFlags('distinct-id')).toEqual({ 'beta-feature': true, 'disabled-feature': false })
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('get all payloads with no fallback', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
            payloads: {
              true: 'new',
            },
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'disabled-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
            payloads: {
              true: 'some-payload',
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect((await posthog.getAllFlagsAndPayloads('distinct-id')).featureFlagPayloads).toEqual({ 'beta-feature': 'new' })
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('computes inactive flags locally as well', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'disabled-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 0,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'beta-feature': 'variant-1', 'beta-feature2': 'variant-2' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(await posthog.getAllFlags('distinct-id')).toEqual({ 'beta-feature': true, 'disabled-feature': false })
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    //   # Now, after a poll interval, flag 1 is inactive, and flag 2 rollout is set to 100%.
    const flags2 = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: false,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Beta Feature',
          key: 'disabled-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags2 }))

    // # force reload to simulate poll interval
    await posthog.reloadFeatureFlags()

    expect(await posthog.getAllFlags('distinct-id')).toEqual({ 'beta-feature': false, 'disabled-feature': true })
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('computes complex cohorts locally', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'region',
                    operator: 'exact',
                    value: ['USA'],
                    type: 'person',
                  },
                  { key: 'id', value: 98, type: 'cohort' },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
      ],
      cohorts: {
        '98': {
          type: 'OR',
          values: [
            { key: 'id', value: 1, type: 'cohort' },
            {
              key: 'nation',
              operator: 'exact',
              value: ['UK'],
              type: 'person',
            },
          ],
        },
        '1': {
          type: 'AND',
          values: [{ key: 'other', operator: 'exact', value: ['thing'], type: 'person' }],
        },
      },
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: {},
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', { personProperties: { region: 'UK' } })
    ).toEqual(false)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    // # even though 'other' property is not present, the cohort should still match since it's an OR condition
    expect(
      await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', {
        personProperties: { region: 'USA', nation: 'UK' },
      })
    ).toEqual(true)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    // # even though 'other' property is not present, the cohort should still match since it's an OR condition
    expect(
      await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', {
        personProperties: { region: 'USA', other: 'thing' },
      })
    ).toEqual(true)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('computes complex cohorts with negation locally', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          rollout_percentage: 100,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'region',
                    operator: 'exact',
                    value: ['USA'],
                    type: 'person',
                  },
                  { key: 'id', value: 98, type: 'cohort' },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
      ],
      cohorts: {
        '98': {
          type: 'OR',
          values: [
            { key: 'id', value: 1, type: 'cohort' },
            {
              key: 'nation',
              operator: 'exact',
              value: ['UK'],
              type: 'person',
            },
          ],
        },
        '1': {
          type: 'AND',
          values: [{ key: 'other', operator: 'exact', value: ['thing'], type: 'person', negation: true }],
        },
      },
    }
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: {},
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', { personProperties: { region: 'UK' } })
    ).toEqual(false)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    // # even though 'other' property is not present, the cohort should still match since it's an OR condition
    expect(
      await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', {
        personProperties: { region: 'USA', nation: 'UK' },
      })
    ).toEqual(true)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)

    // # since 'other' is negated, we return False. Since 'nation' is not present, we can't tell whether the flag should be true or false, so go to flags
    expect(
      await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', {
        personProperties: { region: 'USA', other: 'thing' },
      })
    ).toEqual(undefined)
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)

    mockedFetch.mockClear()

    expect(
      await posthog.getFeatureFlag('beta-feature', 'some-distinct-id', {
        personProperties: { region: 'USA', other: 'thing2' },
      })
    ).toEqual(true)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('gets feature flag with variant overrides', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'email',
                    operator: 'exact',
                    value: 'test@posthog.com',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
                variant: 'second-variant',
              },
              {
                rollout_percentage: 50,
                variant: 'first-variant',
              },
            ],
            multivariate: {
              variants: [
                {
                  key: 'first-variant',
                  name: 'First Variant',
                  rollout_percentage: 50,
                },
                {
                  key: 'second-variant',
                  name: 'Second Variant',
                  rollout_percentage: 25,
                },
                {
                  key: 'third-variant',
                  name: 'Third Variant',
                  rollout_percentage: 25,
                },
              ],
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('beta-feature', 'test_id', { personProperties: { email: 'test@posthog.com' } })
    ).toEqual('second-variant')
    expect(await posthog.getFeatureFlag('beta-feature', 'example_id')).toEqual('first-variant')

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    // flags not called
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('gets feature flag with clashing variant overrides', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'email',
                    operator: 'exact',
                    value: 'test@posthog.com',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
                variant: 'second-variant',
              },
              // # since second-variant comes first in the list, it will be the one that gets picked
              {
                properties: [
                  {
                    key: 'email',
                    operator: 'exact',
                    value: 'test@posthog.com',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
                variant: 'first-variant',
              },
              {
                rollout_percentage: 50,
                variant: 'first-variant',
              },
            ],
            multivariate: {
              variants: [
                {
                  key: 'first-variant',
                  name: 'First Variant',
                  rollout_percentage: 50,
                },
                {
                  key: 'second-variant',
                  name: 'Second Variant',
                  rollout_percentage: 25,
                },
                {
                  key: 'third-variant',
                  name: 'Third Variant',
                  rollout_percentage: 25,
                },
              ],
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('beta-feature', 'test_id', { personProperties: { email: 'test@posthog.com' } })
    ).toEqual('second-variant')
    expect(
      await posthog.getFeatureFlag('beta-feature', 'example_id', { personProperties: { email: 'test@posthog.com' } })
    ).toEqual('second-variant')
    expect(await posthog.getFeatureFlag('beta-feature', 'example_id')).toEqual('first-variant')

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    // flags not called
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('gets feature flag with invalid variant overrides', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'email',
                    operator: 'exact',
                    value: 'test@posthog.com',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
                variant: 'second???',
              },
              {
                rollout_percentage: 50,
                variant: 'first???',
              },
            ],
            multivariate: {
              variants: [
                {
                  key: 'first-variant',
                  name: 'First Variant',
                  rollout_percentage: 50,
                },
                {
                  key: 'second-variant',
                  name: 'Second Variant',
                  rollout_percentage: 25,
                },
                {
                  key: 'third-variant',
                  name: 'Third Variant',
                  rollout_percentage: 25,
                },
              ],
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('beta-feature', 'test_id', { personProperties: { email: 'test@posthog.com' } })
    ).toEqual('third-variant')
    expect(await posthog.getFeatureFlag('beta-feature', 'example_id')).toEqual('second-variant')

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    // flags not called
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('gets feature flag with multiple variant overrides', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                rollout_percentage: 100,
                // # The override applies even if the first condition matches all and gives everyone their default group
              },
              {
                properties: [
                  {
                    key: 'email',
                    operator: 'exact',
                    value: 'test@posthog.com',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
                variant: 'second-variant',
              },
              {
                rollout_percentage: 50,
                variant: 'third-variant',
              },
            ],
            multivariate: {
              variants: [
                {
                  key: 'first-variant',
                  name: 'First Variant',
                  rollout_percentage: 50,
                },
                {
                  key: 'second-variant',
                  name: 'Second Variant',
                  rollout_percentage: 25,
                },
                {
                  key: 'third-variant',
                  name: 'Third Variant',
                  rollout_percentage: 25,
                },
              ],
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlag('beta-feature', 'test_id', { personProperties: { email: 'test@posthog.com' } })
    ).toEqual('second-variant')
    expect(await posthog.getFeatureFlag('beta-feature', 'example_id')).toEqual('third-variant')
    expect(await posthog.getFeatureFlag('beta-feature', 'another_id')).toEqual('second-variant')

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    // flags not called
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('get feature flag payload based on boolean flag', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'person-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'region',
                    operator: 'exact',
                    value: ['USA'],
                    type: 'person',
                  },
                ],
                rollout_percentage: null,
              },
            ],
            payloads: {
              true: {
                log: 'all',
              },
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlagPayload('person-flag', 'some-distinct-id', true, {
        personProperties: { region: 'USA' },
      })
    ).toEqual({
      log: 'all',
    })
    expect(
      await posthog.getFeatureFlagPayload('person-flag', 'some-distinct-id', undefined, {
        personProperties: { region: 'USA' },
      })
    ).toEqual({
      log: 'all',
    })
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    // flags not called
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('get feature flag payload on a multivariate', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'email',
                    operator: 'exact',
                    value: 'test@posthog.com',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
                variant: 'second-variant',
              },
              {
                rollout_percentage: 50,
                variant: 'first-variant',
              },
            ],
            multivariate: {
              variants: [
                {
                  key: 'first-variant',
                  name: 'First Variant',
                  rollout_percentage: 50,
                },
                {
                  key: 'second-variant',
                  name: 'Second Variant',
                  rollout_percentage: 25,
                },
                {
                  key: 'third-variant',
                  name: 'Third Variant',
                  rollout_percentage: 25,
                },
              ],
            },
            payloads: {
              'second-variant': 2500,
            },
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(
      await posthog.getFeatureFlagPayload('beta-feature', 'test_id', 'second-variant', {
        personProperties: { email: 'test@posthog.com' },
      })
    ).toEqual(2500)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    // flags not called
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  describe('isLocalEvaluationReady', () => {
    it('returns false when featureFlagsPoller is undefined', () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        ...posthogImmediateResolveOptions,
      })
      expect(posthog.isLocalEvaluationReady()).toBe(false)
    })

    it('returns false when featureFlagsPoller has not loaded successfully', () => {
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })
      expect(posthog.isLocalEvaluationReady()).toBe(false)
    })

    it('returns false when featureFlagsPoller has no flags', async () => {
      const flags = { flags: [] }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })
      await posthog.reloadFeatureFlags()
      expect(posthog.isLocalEvaluationReady()).toBe(false)
    })

    it('returns true when featureFlagsPoller has loaded flags successfully', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Beta Feature',
            key: 'beta-feature',
            active: true,
            filters: {
              groups: [
                {
                  properties: [],
                  rollout_percentage: 100,
                },
              ],
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })
      await posthog.reloadFeatureFlags()
      expect(posthog.isLocalEvaluationReady()).toBe(true)
    })
  })

  describe('waitForLocalEvaluationReady', () => {
    it('returns true when local evaluation is ready', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Beta Feature',
            key: 'beta-feature',
            active: true,
            filters: {
              groups: [{ properties: [], rollout_percentage: 100 }],
            },
          },
        ],
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })

      expect(await posthog.waitForLocalEvaluationReady()).toBe(true)
    })

    it('returns false when local evaluation endpoint returns empty flags', async () => {
      const flags = { flags: [] }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: 'TEST_PERSONAL_API_KEY',
        ...posthogImmediateResolveOptions,
      })
      expect(await posthog.waitForLocalEvaluationReady()).toBe(false)
    })

    it('returns false when local evaluation is not enabled', async () => {
      const flags = { flags: [] }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))
      posthog = new PostHog('TEST_API_KEY', {
        host: 'http://example.com',
        personalApiKey: undefined,
        ...posthogImmediateResolveOptions,
      })
      expect(await posthog.waitForLocalEvaluationReady()).toBe(false)
    })
  })

  it('emits localEvaluationFlagsLoaded event when flags are loaded', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Alpha Feature',
          key: 'alpha-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 50,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const eventHandler = jest.fn()
    posthog.on('localEvaluationFlagsLoaded', eventHandler)

    // Wait for initial load
    await waitForPromises()

    expect(eventHandler).toHaveBeenCalledWith(2) // Should be called with number of flags loaded
  })

  it('does not emit localEvaluationFlagsLoaded event when loading fails', async () => {
    mockedFetch.mockImplementation(() => {
      throw new Error('Failed to load flags')
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const eventHandler = jest.fn()
    posthog.on('localEvaluationFlagsLoaded', eventHandler)

    // Wait for initial load
    await waitForPromises()

    expect(eventHandler).not.toHaveBeenCalled()
  })

  it('emits localEvaluationFlagsLoaded event on reload', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'beta-feature',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const eventHandler = jest.fn()
    posthog.on('localEvaluationFlagsLoaded', eventHandler)

    // Wait for initial load
    await waitForPromises()
    eventHandler.mockClear() // Clear initial call

    // Reload flags
    await posthog.reloadFeatureFlags()

    expect(eventHandler).toHaveBeenCalledWith(1) // Should be called with number of flags loaded
  })
})

describe('getFeatureFlag', () => {
  it('should capture $feature_flag_called when called, but not add all cached flags', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'complex-flag',
          active: true,
          filters: {
            groups: [
              {
                variant: null,
                properties: [{ key: 'region', type: 'person', value: 'USA', operator: 'exact' }],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Gamma Feature',
          key: 'simple-flag',
          active: true,
          filters: {
            groups: [
              {
                variant: null,
                properties: [],
                rollout_percentage: 100,
              },
            ],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))
    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })
    let capturedMessage: any
    posthog.on('capture', (message) => {
      capturedMessage = message
    })

    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id', {
        personProperties: {
          region: 'USA',
        } as unknown as Record<string, string>,
      })
    ).toEqual(true)

    await waitForPromises()

    expect(capturedMessage).toMatchObject({
      distinct_id: 'some-distinct-id',
      event: '$feature_flag_called',
      library: posthog.getLibraryId(),
      library_version: posthog.getLibraryVersion(),
      properties: {
        '$feature/complex-flag': true,
        $feature_flag: 'complex-flag',
        $feature_flag_response: true,
        $groups: undefined,
        $lib: posthog.getLibraryId(),
        $lib_version: posthog.getLibraryVersion(),
        locally_evaluated: true,
      },
    })

    expect(capturedMessage.properties).not.toHaveProperty('$active_feature_flags')
    expect(capturedMessage.properties).not.toHaveProperty('$feature/simple-flag')
  })
})

describe('match properties', () => {
  jest.useFakeTimers()

  it('with operator exact', () => {
    const property_a = { key: 'key', value: 'value' }

    expect(matchProperty(property_a, { key: 'value' })).toBe(true)

    expect(matchProperty(property_a, { key: 'value2' })).toBe(false)
    expect(matchProperty(property_a, { key: '' })).toBe(false)
    expect(matchProperty(property_a, { key: undefined })).toBe(false)

    expect(() => matchProperty(property_a, { key2: 'value' })).toThrow(InconclusiveMatchError)
    expect(() => matchProperty(property_a, {})).toThrow(InconclusiveMatchError)

    const property_b = { key: 'key', value: 'value', operator: 'exact' }

    expect(matchProperty(property_b, { key: 'value' })).toBe(true)
    expect(matchProperty(property_b, { key: 'value2' })).toBe(false)

    const property_c = { key: 'key', value: ['value1', 'value2', 'value3'], operator: 'exact' }
    expect(matchProperty(property_c, { key: 'value1' })).toBe(true)
    expect(matchProperty(property_c, { key: 'value2' })).toBe(true)
    expect(matchProperty(property_c, { key: 'value3' })).toBe(true)

    expect(matchProperty(property_c, { key: 'value4' })).toBe(false)

    expect(() => matchProperty(property_c, { key2: 'value' })).toThrow(InconclusiveMatchError)
  })

  it('with operator is_not', () => {
    const property_a = { key: 'key', value: 'value', operator: 'is_not' }

    expect(matchProperty(property_a, { key: 'value' })).toBe(false)
    expect(matchProperty(property_a, { key: 'value2' })).toBe(true)
    expect(matchProperty(property_a, { key: '' })).toBe(true)
    expect(matchProperty(property_a, { key: undefined })).toBe(true)

    expect(() => matchProperty(property_a, { key2: 'value' })).toThrow(InconclusiveMatchError)
    expect(() => matchProperty(property_a, {})).toThrow(InconclusiveMatchError)

    const property_c = { key: 'key', value: ['value1', 'value2', 'value3'], operator: 'is_not' }
    expect(matchProperty(property_c, { key: 'value1' })).toBe(false)
    expect(matchProperty(property_c, { key: 'value2' })).toBe(false)
    expect(matchProperty(property_c, { key: 'value3' })).toBe(false)

    expect(matchProperty(property_c, { key: 'value4' })).toBe(true)
    expect(matchProperty(property_c, { key: 'value5' })).toBe(true)
    expect(matchProperty(property_c, { key: '' })).toBe(true)
    expect(matchProperty(property_c, { key: undefined })).toBe(true)

    expect(() => matchProperty(property_c, { key2: 'value' })).toThrow(InconclusiveMatchError)
  })

  it('with operator is_set', () => {
    const property_a = { key: 'key', value: 'is_set', operator: 'is_set' }

    expect(matchProperty(property_a, { key: 'value' })).toBe(true)
    expect(matchProperty(property_a, { key: 'value2' })).toBe(true)
    expect(matchProperty(property_a, { key: '' })).toBe(true)
    expect(matchProperty(property_a, { key: undefined })).toBe(false)

    expect(() => matchProperty(property_a, { key2: 'value' })).toThrow(InconclusiveMatchError)
    expect(() => matchProperty(property_a, {})).toThrow(InconclusiveMatchError)
  })

  it('with operator icontains', () => {
    const property_a = { key: 'key', value: 'vaLuE', operator: 'icontains' }

    expect(matchProperty(property_a, { key: 'value' })).toBe(true)
    expect(matchProperty(property_a, { key: 'value2' })).toBe(true)
    expect(matchProperty(property_a, { key: 'vaLue3' })).toBe(true)
    expect(matchProperty(property_a, { key: '343tfvalUe5' })).toBe(true)

    expect(matchProperty(property_a, { key: '' })).toBe(false)
    expect(matchProperty(property_a, { key: undefined })).toBe(false)
    expect(matchProperty(property_a, { key: 1234 })).toBe(false)
    expect(matchProperty(property_a, { key: '1234' })).toBe(false)

    expect(() => matchProperty(property_a, { key2: 'value' })).toThrow(InconclusiveMatchError)
    expect(() => matchProperty(property_a, {})).toThrow(InconclusiveMatchError)

    const property_b = { key: 'key', value: '3', operator: 'icontains' }

    expect(matchProperty(property_b, { key: '3' })).toBe(true)
    expect(matchProperty(property_b, { key: 323 })).toBe(true)
    expect(matchProperty(property_b, { key: 'val3' })).toBe(true)

    expect(matchProperty(property_b, { key: 'three' })).toBe(false)
  })

  it('with operator regex', () => {
    const property_a = { key: 'key', value: '\\.com$', operator: 'regex' }

    expect(matchProperty(property_a, { key: 'value.com' })).toBe(true)
    expect(matchProperty(property_a, { key: 'value2.com' })).toBe(true)

    expect(matchProperty(property_a, { key: 'valuecom' })).toBe(false)
    expect(matchProperty(property_a, { key: 'valuecom' })).toBe(false)
    expect(matchProperty(property_a, { key: '.com343tfvalue5' })).toBe(false)
    expect(matchProperty(property_a, { key: undefined })).toBe(false)
    expect(matchProperty(property_a, { key: '' })).toBe(false)

    expect(() => matchProperty(property_a, { key2: 'value' })).toThrow(InconclusiveMatchError)
    expect(() => matchProperty(property_a, {})).toThrow(InconclusiveMatchError)

    const property_b = { key: 'key', value: '3', operator: 'regex' }

    expect(matchProperty(property_b, { key: '3' })).toBe(true)
    expect(matchProperty(property_b, { key: 323 })).toBe(true)
    expect(matchProperty(property_b, { key: 'val3' })).toBe(true)

    expect(matchProperty(property_b, { key: 'three' })).toBe(false)

    // # invalid regex
    const property_c = { key: 'key', value: '?*', operator: 'regex' }
    expect(matchProperty(property_c, { key: 'value.com' })).toBe(false)
    expect(matchProperty(property_c, { key: 'value2' })).toBe(false)

    // # non string value
    const property_d = { key: 'key', value: 4, operator: 'regex' }
    expect(matchProperty(property_d, { key: '4' })).toBe(true)
    expect(matchProperty(property_d, { key: 4 })).toBe(true)

    expect(matchProperty(property_d, { key: 'value' })).toBe(false)

    // # non string value - not_regex
    const property_e = { key: 'key', value: 4, operator: 'not_regex' }
    expect(matchProperty(property_e, { key: '4' })).toBe(false)
    expect(matchProperty(property_e, { key: 4 })).toBe(false)

    expect(matchProperty(property_e, { key: 'value' })).toBe(true)
  })

  it('with math operators', () => {
    const property_a = { key: 'key', value: 1, operator: 'gt' }

    expect(matchProperty(property_a, { key: 2 })).toBe(true)
    expect(matchProperty(property_a, { key: 3 })).toBe(true)

    expect(matchProperty(property_a, { key: 0 })).toBe(false)
    expect(matchProperty(property_a, { key: -1 })).toBe(false)
    // # now we handle type mismatches so this should be true
    expect(matchProperty(property_a, { key: '23' })).toBe(true)

    const property_b = { key: 'key', value: 1, operator: 'lt' }
    expect(matchProperty(property_b, { key: 0 })).toBe(true)
    expect(matchProperty(property_b, { key: -1 })).toBe(true)
    expect(matchProperty(property_b, { key: -3 })).toBe(true)

    expect(matchProperty(property_b, { key: '3' })).toBe(false)
    expect(matchProperty(property_b, { key: '1' })).toBe(false)
    expect(matchProperty(property_b, { key: 1 })).toBe(false)

    const property_c = { key: 'key', value: 1, operator: 'gte' }
    expect(matchProperty(property_c, { key: 2 })).toBe(true)
    expect(matchProperty(property_c, { key: 1 })).toBe(true)

    expect(matchProperty(property_c, { key: 0 })).toBe(false)
    expect(matchProperty(property_c, { key: -1 })).toBe(false)
    expect(matchProperty(property_c, { key: -3 })).toBe(false)
    // # now we handle type mismatches so this should be true
    expect(matchProperty(property_c, { key: '3' })).toBe(true)

    const property_d = { key: 'key', value: '43', operator: 'lte' }
    expect(matchProperty(property_d, { key: '43' })).toBe(true)
    expect(matchProperty(property_d, { key: '42' })).toBe(true)

    expect(matchProperty(property_d, { key: '44' })).toBe(false)
    expect(matchProperty(property_d, { key: 44 })).toBe(false)
    expect(matchProperty(property_d, { key: 42 })).toBe(true)

    const property_e = { key: 'key', value: '30', operator: 'lt' }
    expect(matchProperty(property_e, { key: '29' })).toBe(true)

    // # depending on the type of override, we adjust type comparison
    expect(matchProperty(property_e, { key: '100' })).toBe(true)
    expect(matchProperty(property_e, { key: 100 })).toBe(false)

    const property_f = { key: 'key', value: '123aloha', operator: 'gt' }
    expect(matchProperty(property_f, { key: '123' })).toBe(false)
    expect(matchProperty(property_f, { key: 122 })).toBe(false)

    // # this turns into a string comparison
    expect(matchProperty(property_f, { key: 129 })).toBe(true)
  })

  it('with date operators', () => {
    // is date before
    const property_a = { key: 'key', value: '2022-05-01', operator: 'is_date_before' }
    expect(matchProperty(property_a, { key: '2022-03-01' })).toBe(true)
    expect(matchProperty(property_a, { key: '2022-04-30' })).toBe(true)
    expect(matchProperty(property_a, { key: new Date(2022, 3, 30) })).toBe(true)
    expect(matchProperty(property_a, { key: new Date(2022, 3, 30, 1, 2, 3) })).toBe(true)
    expect(matchProperty(property_a, { key: new Date('2022-04-30T00:00:00+02:00') })).toBe(true) // europe/madrid
    expect(matchProperty(property_a, { key: new Date('2022-04-30') })).toBe(true)
    expect(matchProperty(property_a, { key: '2022-05-30' })).toBe(false)

    // is date after
    const property_b = { key: 'key', value: '2022-05-01', operator: 'is_date_after' }
    expect(matchProperty(property_b, { key: '2022-05-02' })).toBe(true)
    expect(matchProperty(property_b, { key: '2022-05-30' })).toBe(true)
    expect(matchProperty(property_b, { key: new Date(2022, 4, 30) })).toBe(true)
    expect(matchProperty(property_b, { key: new Date('2022-05-30') })).toBe(true)
    expect(matchProperty(property_b, { key: '2022-04-30' })).toBe(false)

    // can't be an invalid number or invalid string
    expect(() => matchProperty(property_a, { key: parseInt('62802180000012345') })).toThrow(InconclusiveMatchError)
    expect(() => matchProperty(property_a, { key: 'abcdef' })).toThrow(InconclusiveMatchError)
    // invalid flag property
    const property_c = { key: 'key', value: 'abcd123', operator: 'is_date_before' }
    expect(() => matchProperty(property_c, { key: '2022-05-30' })).toThrow(InconclusiveMatchError)

    // Timezone
    const property_d = { key: 'key', value: '2022-04-05 12:34:12 +01:00', operator: 'is_date_before' }
    expect(matchProperty(property_d, { key: '2022-05-30' })).toBe(false)

    expect(matchProperty(property_d, { key: '2022-03-30' })).toBe(true)
    expect(matchProperty(property_d, { key: '2022-04-05 12:34:11+01:00' })).toBe(true)
    expect(matchProperty(property_d, { key: '2022-04-05 11:34:11 +00:00' })).toBe(true)
    expect(matchProperty(property_d, { key: '2022-04-05 11:34:13 +00:00' })).toBe(false)
  })

  it.each([
    ['is_date_before', '-6h', '2022-03-01', true],
    ['is_date_before', '-6h', '2022-04-30', true],
    // :TRICKY: MonthIndex is 0 indexed, so 3 is actually the 4th month, April.
    ['is_date_before', '-6h', new Date(Date.UTC(2022, 3, 30, 1, 2, 3)), true],
    // false because date comparison, instead of datetime, so reduces to same date
    ['is_date_before', '-6h', new Date('2022-04-30T01:02:03+02:00'), true], // europe/madrid
    ['is_date_before', '-6h', new Date('2022-04-30T20:02:03+02:00'), false], // europe/madrid
    ['is_date_before', '-6h', new Date('2022-04-30T19:59:03+02:00'), true], // europe/madrid
    ['is_date_before', '-6h', new Date('2022-04-30'), true],
    ['is_date_before', '-6h', '2022-05-30', false],
    // is date after
    ['is_date_after', '1h', '2022-05-02', true],
    ['is_date_after', '1h', '2022-05-30', true],
    ['is_date_after', '1h', new Date(2022, 4, 30), true],
    ['is_date_after', '1h', new Date('2022-05-30'), true],
    ['is_date_after', '1h', '2022-04-30', false],
    // # Try all possible relative dates
    ['is_date_before', '1h', '2022-05-01 00:00:00 GMT', false],
    ['is_date_before', '1h', '2022-04-30 22:00:00 GMT', true],
    ['is_date_before', '-1d', '2022-04-29 23:59:00 GMT', true],
    ['is_date_before', '-1d', '2022-04-30 00:00:01 GMT', false],
    ['is_date_before', '1w', '2022-04-23 00:00:00 GMT', true],
    ['is_date_before', '1w', '2022-04-24 00:00:00 GMT', false],
    ['is_date_before', '1w', '2022-04-24 00:00:01 GMT', false],
    ['is_date_before', '1m', '2022-03-01 00:00:00 GMT', true],
    ['is_date_before', '1m', '2022-04-01 00:00:00 GMT', false],
    ['is_date_before', '1m', '2022-04-05 00:00:01 GMT', false],

    ['is_date_before', '-1y', '2021-04-28 00:00:00 GMT', true],
    ['is_date_before', '-1y', '2021-05-01 00:00:01 GMT', false],

    ['is_date_after', '122h', '2022-05-01 00:00:00 GMT', true],
    ['is_date_after', '122h', '2022-04-23 01:00:00 GMT', false],

    ['is_date_after', '2d', '2022-05-01 00:00:00 GMT', true],
    ['is_date_after', '2d', '2022-04-29 00:00:01 GMT', true],
    ['is_date_after', '2d', '2022-04-29 00:00:00 GMT', false],

    ['is_date_after', '02w', '2022-05-01 00:00:00 GMT', true],
    ['is_date_after', '02w', '2022-04-16 00:00:00 GMT', false],

    ['is_date_after', '-1m', '2022-04-01 00:00:01 GMT', true],
    ['is_date_after', '-1m', '2022-04-01 00:00:00 GMT', false],

    ['is_date_after', '1y', '2022-05-01 00:00:00 GMT', true],
    ['is_date_after', '1y', '2021-05-01 00:00:01 GMT', true],
    ['is_date_after', '1y', '2021-05-01 00:00:00 GMT', false],
    ['is_date_after', '1y', '2021-04-30 00:00:00 GMT', false],
    ['is_date_after', '1y', '2021-03-01 12:13:00 GMT', false],
  ])('with relative date operators: %s, %s, %s', (operator, value, date, expectation) => {
    jest.setSystemTime(new Date('2022-05-01'))
    expect(matchProperty({ key: 'key', value, operator }, { key: date })).toBe(expectation)

    return
  })

  it('with relative date operators handles invalid keys', () => {
    jest.setSystemTime(new Date('2022-05-01'))

    // # can't be an invalid string
    expect(() => matchProperty({ key: 'key', value: '1d', operator: 'is_date_before' }, { key: 'abcdef' })).toThrow(
      InconclusiveMatchError
    )
    // however js understands numbers as date offsets from utc epoch
    expect(() => matchProperty({ key: 'key', value: '1d', operator: 'is_date_before' }, { key: 1 })).not.toThrow(
      InconclusiveMatchError
    )
  })

  it('null or undefined property value', () => {
    const property_a = { key: 'key', value: 'null', operator: 'is_not' }
    expect(matchProperty(property_a, { key: null })).toBe(false)
    expect(matchProperty(property_a, { key: undefined })).toBe(true)
    expect(matchProperty(property_a, { key: 'null' })).toBe(false)
    expect(matchProperty(property_a, { key: 'nul' })).toBe(true)

    const property_b = { key: 'key', value: 'null', operator: 'is_set' }
    expect(matchProperty(property_b, { key: null })).toBe(false)
    expect(matchProperty(property_b, { key: undefined })).toBe(false)
    expect(matchProperty(property_b, { key: 'null' })).toBe(true)

    const property_c = { key: 'key', value: 'undefined', operator: 'icontains' }
    expect(matchProperty(property_c, { key: null })).toBe(false)
    expect(matchProperty(property_c, { key: undefined })).toBe(false)
    expect(matchProperty(property_c, { key: 'lol' })).toBe(false)

    const property_d = { key: 'key', value: 'undefined', operator: 'regex' }
    expect(matchProperty(property_d, { key: null })).toBe(false)
    expect(matchProperty(property_d, { key: undefined })).toBe(false)

    const property_e = { key: 'key', value: 1, operator: 'gt' }
    expect(matchProperty(property_e, { key: null })).toBe(false)
    expect(matchProperty(property_e, { key: undefined })).toBe(false)

    const property_f = { key: 'key', value: 1, operator: 'lt' }
    expect(matchProperty(property_f, { key: null })).toBe(false)
    expect(matchProperty(property_f, { key: undefined })).toBe(false)

    const property_g = { key: 'key', value: 'xyz', operator: 'gte' }
    expect(matchProperty(property_g, { key: null })).toBe(false)
    expect(matchProperty(property_g, { key: undefined })).toBe(false)

    const property_h = { key: 'key', value: 'Oo', operator: 'lte' }
    expect(matchProperty(property_h, { key: null })).toBe(false)
    expect(matchProperty(property_h, { key: undefined })).toBe(false)

    const property_h_lower = { key: 'key', value: 'oo', operator: 'lte' }
    expect(matchProperty(property_h_lower, { key: null })).toBe(false)
    expect(matchProperty(property_h_lower, { key: undefined })).toBe(false)

    const property_i = { key: 'key', value: '2022-05-01', operator: 'is_date_before' }

    expect(matchProperty(property_i, { key: null })).toBe(false)
    expect(matchProperty(property_i, { key: undefined })).toBe(false)

    const property_j = { key: 'key', value: '2022-05-01', operator: 'is_date_after' }
    expect(matchProperty(property_j, { key: null })).toBe(false)

    const property_k = { key: 'key', value: '2022-05-01', operator: 'is_date_before' }
    expect(matchProperty(property_k, { key: null })).toBe(false)
  })

  it('null or undefined override value', () => {
    const property_a = { key: 'key', value: 'ab', operator: 'is_not' }
    expect(matchProperty(property_a, { key: null })).toBe(true)
    expect(matchProperty(property_a, { key: undefined })).toBe(true)
    expect(matchProperty(property_a, { key: 'null' })).toBe(true)
    expect(matchProperty(property_a, { key: 'nul' })).toBe(true)

    const property_b = { key: 'key', value: 'null', operator: 'is_set' }
    expect(matchProperty(property_b, { key: null })).toBe(false)
    expect(matchProperty(property_b, { key: undefined })).toBe(false)
    expect(matchProperty(property_b, { key: 'null' })).toBe(true)

    const property_c = { key: 'key', value: 'app.posthog.com', operator: 'icontains' }
    expect(matchProperty(property_c, { key: null })).toBe(false)
    expect(matchProperty(property_c, { key: undefined })).toBe(false)
    expect(matchProperty(property_c, { key: 'lol' })).toBe(false)
    expect(matchProperty(property_c, { key: 'https://app.posthog.com' })).toBe(true)

    const property_d = { key: 'key', value: '.+', operator: 'regex' }
    expect(matchProperty(property_d, { key: null })).toBe(false)
    expect(matchProperty(property_d, { key: undefined })).toBe(false)
    expect(matchProperty(property_d, { key: 'i_am_a_value' })).toBe(true)

    const property_e = { key: 'key', value: 1, operator: 'gt' }
    expect(matchProperty(property_e, { key: null })).toBe(false)
    expect(matchProperty(property_e, { key: undefined })).toBe(false)
    expect(matchProperty(property_e, { key: 1 })).toBe(false)
    expect(matchProperty(property_e, { key: 2 })).toBe(true)

    const property_f = { key: 'key', value: 1, operator: 'lt' }
    expect(matchProperty(property_f, { key: null })).toBe(false)
    expect(matchProperty(property_f, { key: undefined })).toBe(false)
    expect(matchProperty(property_f, { key: 0 })).toBe(true)

    const property_g = { key: 'key', value: 'xyz', operator: 'gte' }
    expect(matchProperty(property_g, { key: null })).toBe(false)
    expect(matchProperty(property_g, { key: undefined })).toBe(false)
    expect(matchProperty(property_g, { key: 'xyz' })).toBe(true)

    const property_h = { key: 'key', value: 'Oo', operator: 'lte' }
    expect(matchProperty(property_h, { key: null })).toBe(false)
    expect(matchProperty(property_h, { key: undefined })).toBe(false)
    expect(matchProperty(property_h, { key: 'Oo' })).toBe(true)

    const property_h_lower = { key: 'key', value: 'oo', operator: 'lte' }
    expect(matchProperty(property_h_lower, { key: null })).toBe(false)
    expect(matchProperty(property_h_lower, { key: undefined })).toBe(false)
    expect(matchProperty(property_h_lower, { key: 'oo' })).toBe(true)

    const property_i = { key: 'key', value: '2022-05-01', operator: 'is_date_before' }
    expect(matchProperty(property_i, { key: null })).toBe(false)
    expect(matchProperty(property_i, { key: undefined })).toBe(false)

    const property_j = { key: 'key', value: '2022-05-01', operator: 'is_date_after' }
    expect(matchProperty(property_j, { key: null })).toBe(false)

    const property_k = { key: 'key', value: '2022-05-01', operator: 'is_date_before' }
    expect(matchProperty(property_k, { key: null })).toBe(false)
  })

  it('with invalid operator', () => {
    const property_a = { key: 'key', value: '2022-05-01', operator: 'is_unknown' }

    expect(() => matchProperty(property_a, { key: 'random' })).toThrow(
      new InconclusiveMatchError('Unknown operator: is_unknown')
    )
  })
})

describe('relative date parsing', () => {
  jest.useFakeTimers()
  beforeEach(() => {
    jest.setSystemTime(new Date('2020-01-01T12:01:20.134Z'))
  })

  it('invalid input', () => {
    expect(relativeDateParseForFeatureFlagMatching('1')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('1x')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('1.2y')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('1z')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('1s')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('123344000.134m')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('bazinga')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('000bello')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('000hello')).toBe(null)

    expect(relativeDateParseForFeatureFlagMatching('000h')).not.toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('1000h')).not.toBe(null)
  })

  it('overflow', () => {
    expect(relativeDateParseForFeatureFlagMatching('1000000h')).toBe(null)
    expect(relativeDateParseForFeatureFlagMatching('100000000000000000y')).toBe(null)
  })

  it('hour parsing', () => {
    expect(relativeDateParseForFeatureFlagMatching('1h')).toEqual(new Date('2020-01-01T11:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('2h')).toEqual(new Date('2020-01-01T10:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('24h')).toEqual(new Date('2019-12-31T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('30h')).toEqual(new Date('2019-12-31T06:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('48h')).toEqual(new Date('2019-12-30T12:01:20.134Z'))

    expect(relativeDateParseForFeatureFlagMatching('24h')).toEqual(relativeDateParseForFeatureFlagMatching('1d'))
    expect(relativeDateParseForFeatureFlagMatching('48h')).toEqual(relativeDateParseForFeatureFlagMatching('2d'))
  })

  it('day parsing', () => {
    expect(relativeDateParseForFeatureFlagMatching('1d')).toEqual(new Date('2019-12-31T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('2d')).toEqual(new Date('2019-12-30T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('7d')).toEqual(new Date('2019-12-25T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('14d')).toEqual(new Date('2019-12-18T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('30d')).toEqual(new Date('2019-12-02T12:01:20.134Z'))

    expect(relativeDateParseForFeatureFlagMatching('7d')).toEqual(relativeDateParseForFeatureFlagMatching('1w'))
  })

  it('week parsing', () => {
    expect(relativeDateParseForFeatureFlagMatching('1w')).toEqual(new Date('2019-12-25T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('2w')).toEqual(new Date('2019-12-18T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('4w')).toEqual(new Date('2019-12-04T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('8w')).toEqual(new Date('2019-11-06T12:01:20.134Z'))

    expect(relativeDateParseForFeatureFlagMatching('1m')).toEqual(new Date('2019-12-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('4w')).not.toEqual(relativeDateParseForFeatureFlagMatching('1m'))
  })

  it('month parsing', () => {
    expect(relativeDateParseForFeatureFlagMatching('1m')).toEqual(new Date('2019-12-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('2m')).toEqual(new Date('2019-11-01T12:01:20.134Z'))

    expect(relativeDateParseForFeatureFlagMatching('4m')).toEqual(new Date('2019-09-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('5m')).toEqual(new Date('2019-08-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('6m')).toEqual(new Date('2019-07-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('8m')).toEqual(new Date('2019-05-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('10m')).toEqual(new Date('2019-03-01T12:01:20.134Z'))

    expect(relativeDateParseForFeatureFlagMatching('24m')).toEqual(new Date('2018-01-01T12:01:20.134Z'))

    expect(relativeDateParseForFeatureFlagMatching('1y')).toEqual(new Date('2019-01-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('12m')).toEqual(relativeDateParseForFeatureFlagMatching('1y'))

    jest.setSystemTime(new Date('2020-04-03T00:00:00Z'))
    expect(relativeDateParseForFeatureFlagMatching('1m')).toEqual(new Date('2020-03-03T00:00:00Z'))
    expect(relativeDateParseForFeatureFlagMatching('2m')).toEqual(new Date('2020-02-03T00:00:00Z'))
    expect(relativeDateParseForFeatureFlagMatching('4m')).toEqual(new Date('2019-12-03T00:00:00Z'))
    expect(relativeDateParseForFeatureFlagMatching('8m')).toEqual(new Date('2019-08-03T00:00:00Z'))

    expect(relativeDateParseForFeatureFlagMatching('1y')).toEqual(new Date('2019-04-03T00:00:00Z'))
    expect(relativeDateParseForFeatureFlagMatching('12m')).toEqual(relativeDateParseForFeatureFlagMatching('1y'))
  })

  it('year parsing', () => {
    expect(relativeDateParseForFeatureFlagMatching('1y')).toEqual(new Date('2019-01-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('2y')).toEqual(new Date('2018-01-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('4y')).toEqual(new Date('2016-01-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('8y')).toEqual(new Date('2012-01-01T12:01:20.134Z'))

    expect(relativeDateParseForFeatureFlagMatching('1y')).toEqual(new Date('2019-01-01T12:01:20.134Z'))
    expect(relativeDateParseForFeatureFlagMatching('12m')).toEqual(relativeDateParseForFeatureFlagMatching('1y'))
  })
})

describe('consistency tests', () => {
  // # These tests are the same across all libraries
  // # See https://github.com/PostHog/posthog/blob/master/posthog/test/test_feature_flag.py#L627
  // # where this test has directly been copied from.
  // # They ensure that the server and library hash calculations are in sync.

  let posthog: PostHog
  jest.useFakeTimers()

  it('is consistent for simple flags', () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: '',
          key: 'simple-flag',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 45 }],
          },
        },
      ],
    }

    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags, decideFlags: {}, flagsStatus: 400 }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const results = [
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
    ]

    results.forEach(async (result, index) => {
      const distinctId = `distinct_id_${index}`
      const value = await posthog.isFeatureEnabled('simple-flag', distinctId)
      expect(value).toBe(result)
    })
  })

  it('is consistent for multivariate flags', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Beta Feature',
          key: 'multivariate-flag',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 55 }],
            multivariate: {
              variants: [
                { key: 'first-variant', name: 'First Variant', rollout_percentage: 50 },
                { key: 'second-variant', name: 'Second Variant', rollout_percentage: 20 },
                { key: 'third-variant', name: 'Third Variant', rollout_percentage: 20 },
                { key: 'fourth-variant', name: 'Fourth Variant', rollout_percentage: 5 },
                { key: 'fifth-variant', name: 'Fifth Variant', rollout_percentage: 5 },
              ],
            },
          },
        },
      ],
    }

    mockedFetch.mockImplementation(apiImplementation({ localFlags: flags, decideFlags: {}, flagsStatus: 400 }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const results = [
      'second-variant',
      'second-variant',
      'first-variant',
      false,
      false,
      'second-variant',
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      'third-variant',
      false,
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      false,
      'fourth-variant',
      'first-variant',
      false,
      'third-variant',
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'third-variant',
      false,
      'third-variant',
      'second-variant',
      'first-variant',
      false,
      'third-variant',
      false,
      false,
      'first-variant',
      'second-variant',
      false,
      'first-variant',
      'first-variant',
      'second-variant',
      false,
      'first-variant',
      false,
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      'second-variant',
      'second-variant',
      'third-variant',
      'second-variant',
      'first-variant',
      false,
      'first-variant',
      'second-variant',
      'fourth-variant',
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      'second-variant',
      false,
      'third-variant',
      false,
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      'fifth-variant',
      false,
      'second-variant',
      'first-variant',
      'second-variant',
      false,
      'third-variant',
      'third-variant',
      false,
      false,
      false,
      false,
      'third-variant',
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      'third-variant',
      'third-variant',
      false,
      'third-variant',
      'second-variant',
      'third-variant',
      false,
      false,
      'second-variant',
      'first-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'second-variant',
      false,
      'second-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      'second-variant',
      'second-variant',
      false,
      'first-variant',
      false,
      false,
      false,
      'third-variant',
      'first-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      'fifth-variant',
      'second-variant',
      false,
      'second-variant',
      false,
      'first-variant',
      'third-variant',
      'first-variant',
      'fifth-variant',
      'third-variant',
      false,
      false,
      'fourth-variant',
      false,
      false,
      false,
      false,
      'third-variant',
      false,
      false,
      'third-variant',
      false,
      'first-variant',
      'second-variant',
      'second-variant',
      'second-variant',
      false,
      'first-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      'second-variant',
      false,
      false,
      false,
      'second-variant',
      false,
      false,
      'first-variant',
      false,
      'first-variant',
      false,
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'third-variant',
      'first-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      'second-variant',
      'third-variant',
      'third-variant',
      false,
      'second-variant',
      'first-variant',
      false,
      'second-variant',
      'first-variant',
      false,
      'first-variant',
      false,
      false,
      'first-variant',
      'fifth-variant',
      'first-variant',
      false,
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'second-variant',
      false,
      'second-variant',
      'third-variant',
      'third-variant',
      false,
      'first-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      false,
      'third-variant',
      'first-variant',
      false,
      'third-variant',
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      'second-variant',
      'second-variant',
      'first-variant',
      false,
      false,
      false,
      'second-variant',
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      'third-variant',
      false,
      'first-variant',
      false,
      'third-variant',
      false,
      'third-variant',
      'second-variant',
      'first-variant',
      false,
      false,
      'first-variant',
      'third-variant',
      'first-variant',
      'second-variant',
      'fifth-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      'third-variant',
      false,
      'second-variant',
      'first-variant',
      false,
      false,
      false,
      false,
      'third-variant',
      false,
      false,
      'third-variant',
      false,
      false,
      'first-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      'fourth-variant',
      'fourth-variant',
      'third-variant',
      'second-variant',
      'first-variant',
      'third-variant',
      'fifth-variant',
      false,
      'first-variant',
      'fifth-variant',
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      'second-variant',
      'fifth-variant',
      'second-variant',
      'first-variant',
      'first-variant',
      'second-variant',
      false,
      false,
      'third-variant',
      false,
      'second-variant',
      'fifth-variant',
      false,
      'third-variant',
      'first-variant',
      false,
      false,
      'fourth-variant',
      false,
      false,
      'second-variant',
      false,
      false,
      'first-variant',
      'fourth-variant',
      'first-variant',
      'second-variant',
      false,
      false,
      false,
      'first-variant',
      'third-variant',
      'third-variant',
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      false,
      'first-variant',
      'third-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      'second-variant',
      'second-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      'fifth-variant',
      'first-variant',
      false,
      false,
      false,
      'second-variant',
      'third-variant',
      'first-variant',
      'fourth-variant',
      'first-variant',
      'third-variant',
      false,
      'first-variant',
      'first-variant',
      false,
      'third-variant',
      'first-variant',
      'first-variant',
      'third-variant',
      false,
      'fourth-variant',
      'fifth-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      'first-variant',
      'second-variant',
      false,
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      false,
      'first-variant',
      false,
      'first-variant',
      false,
      false,
      false,
      'third-variant',
      'third-variant',
      'first-variant',
      false,
      false,
      'second-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      'second-variant',
      'first-variant',
      false,
      'first-variant',
      'third-variant',
      false,
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      'third-variant',
      'third-variant',
      false,
      false,
      false,
      false,
      'third-variant',
      'fourth-variant',
      'fourth-variant',
      'first-variant',
      'second-variant',
      false,
      'first-variant',
      false,
      'second-variant',
      'first-variant',
      'third-variant',
      false,
      'third-variant',
      false,
      'first-variant',
      'first-variant',
      'third-variant',
      false,
      false,
      false,
      'fourth-variant',
      'second-variant',
      'first-variant',
      false,
      false,
      'first-variant',
      'fourth-variant',
      false,
      'first-variant',
      'third-variant',
      'first-variant',
      false,
      false,
      'third-variant',
      false,
      'first-variant',
      false,
      'first-variant',
      'first-variant',
      'third-variant',
      'second-variant',
      'fourth-variant',
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      'second-variant',
      'first-variant',
      'second-variant',
      false,
      'first-variant',
      false,
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      'first-variant',
      'second-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      'third-variant',
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      'fifth-variant',
      'fourth-variant',
      'first-variant',
      'second-variant',
      false,
      'fourth-variant',
      false,
      false,
      false,
      'fourth-variant',
      false,
      false,
      'third-variant',
      false,
      false,
      false,
      'first-variant',
      'third-variant',
      'third-variant',
      'second-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      'second-variant',
      false,
      false,
      'first-variant',
      false,
      'second-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'third-variant',
      'second-variant',
      false,
      false,
      'fifth-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      'second-variant',
      'third-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      false,
      'third-variant',
      'first-variant',
      false,
      false,
      false,
      false,
      'fourth-variant',
      'first-variant',
      false,
      false,
      false,
      'third-variant',
      false,
      false,
      'second-variant',
      'first-variant',
      false,
      false,
      'second-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      'first-variant',
      false,
      false,
      'second-variant',
      'third-variant',
      'second-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      'first-variant',
      false,
      'second-variant',
      false,
      false,
      false,
      false,
      'first-variant',
      false,
      'third-variant',
      false,
      'first-variant',
      false,
      false,
      'second-variant',
      'third-variant',
      'second-variant',
      'fourth-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      false,
      'second-variant',
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      false,
      'second-variant',
      false,
      false,
      false,
      false,
      'second-variant',
      false,
      'first-variant',
      false,
      'third-variant',
      false,
      false,
      'first-variant',
      'third-variant',
      false,
      'third-variant',
      false,
      false,
      'second-variant',
      false,
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      'second-variant',
      false,
      false,
      'first-variant',
      'third-variant',
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      'second-variant',
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'fifth-variant',
      false,
      false,
      false,
      'first-variant',
      false,
      'third-variant',
      false,
      false,
      'second-variant',
      false,
      false,
      false,
      false,
      false,
      'fourth-variant',
      'second-variant',
      'first-variant',
      'second-variant',
      false,
      'second-variant',
      false,
      'second-variant',
      false,
      'first-variant',
      false,
      'first-variant',
      'first-variant',
      false,
      'second-variant',
      false,
      'first-variant',
      false,
      'fifth-variant',
      false,
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      false,
      'first-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      false,
      'fifth-variant',
      false,
      false,
      'third-variant',
      false,
      'third-variant',
      'first-variant',
      'first-variant',
      'third-variant',
      'third-variant',
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      'second-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      'fifth-variant',
      'first-variant',
      false,
      false,
      'fourth-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      'fourth-variant',
      'first-variant',
      false,
      'second-variant',
      'third-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      'third-variant',
      'third-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      'second-variant',
      false,
      false,
      'second-variant',
      false,
      'third-variant',
      'first-variant',
      'second-variant',
      'fifth-variant',
      'first-variant',
      'first-variant',
      false,
      'first-variant',
      'fifth-variant',
      false,
      false,
      false,
      'third-variant',
      'first-variant',
      'first-variant',
      'second-variant',
      'fourth-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      false,
      false,
      false,
      'second-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      'third-variant',
      false,
      'first-variant',
      false,
      'third-variant',
      'third-variant',
      'first-variant',
      'first-variant',
      false,
      'second-variant',
      false,
      'second-variant',
      'first-variant',
      false,
      false,
      false,
      'second-variant',
      false,
      'third-variant',
      false,
      'first-variant',
      'fifth-variant',
      'first-variant',
      'first-variant',
      false,
      false,
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      'fourth-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'fifth-variant',
      false,
      false,
      false,
      'second-variant',
      false,
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      false,
      'first-variant',
      'first-variant',
      'second-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      'third-variant',
      'first-variant',
      false,
      'second-variant',
      false,
      false,
      'third-variant',
      'second-variant',
      'third-variant',
      false,
      'first-variant',
      'third-variant',
      'second-variant',
      'first-variant',
      'third-variant',
      false,
      false,
      'first-variant',
      'first-variant',
      false,
      false,
      false,
      'first-variant',
      'third-variant',
      'second-variant',
      'first-variant',
      'first-variant',
      'first-variant',
      false,
      'third-variant',
      'second-variant',
      'third-variant',
      false,
      false,
      'third-variant',
      'first-variant',
      false,
      'first-variant',
    ]

    results.forEach(async (result, index) => {
      const distinctId = `distinct_id_${index}`
      const value = await posthog.getFeatureFlag('multivariate-flag', distinctId)
      expect(value).toBe(result)
    })
  })
})

describe('quota limiting', () => {
  it('should clear local flags when quota limited', async () => {
    const consoleSpy = jest.spyOn(console, 'warn')

    mockedFetch.mockImplementation(
      apiImplementation({
        localFlagsStatus: 402,
      })
    )

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // Enable debug mode to see the messages
    posthog.debug(true)

    // Force a reload and wait for it to complete
    await posthog.reloadFeatureFlags()

    // locally evaluate the flags
    const res = await posthog.getAllFlagsAndPayloads('distinct-id', { onlyEvaluateLocally: true })

    // expect the flags to be cleared and for the debug message to be logged
    expect(res.featureFlags).toEqual({})
    expect(res.featureFlagPayloads).toEqual({})
    expect(consoleSpy).toHaveBeenCalledWith(
      '[FEATURE FLAGS] Feature flags quota limit exceeded - unsetting all local flags. Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts'
    )

    consoleSpy.mockRestore()
  })
})
