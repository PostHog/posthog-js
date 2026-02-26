import { PostHogOptions } from '@/types'
import { PostHog } from '@/entrypoints/index.node'
import {
  matchProperty,
  InconclusiveMatchError,
  relativeDateParseForFeatureFlagMatching,
} from '@/extensions/feature-flags/feature-flags'
import { anyFlagsCall, anyLocalEvalCall, apiImplementation, waitForPromises } from './utils'

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

  it('falls back to server when bucketing_identifier is device_id and $device_id is missing', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Device Flag',
          key: 'device-id-flag',
          bucketing_identifier: 'device_id',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
      ],
    }

    mockedFetch.mockImplementation(
      apiImplementation({ localFlags: flags, decideFlags: { 'device-id-flag': 'flags-fallback-value' } })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(await posthog.getFeatureFlag('device-id-flag', 'some-distinct-id')).toEqual('flags-fallback-value')
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('does not fallback to server for missing $device_id when onlyEvaluateLocally is true', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Device Flag',
          key: 'device-id-flag',
          bucketing_identifier: 'device_id',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
      ],
    }

    mockedFetch.mockImplementation(
      apiImplementation({ localFlags: flags, decideFlags: { 'device-id-flag': 'flags-fallback-value' } })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    expect(await posthog.getFeatureFlag('device-id-flag', 'some-distinct-id', { onlyEvaluateLocally: true })).toEqual(
      undefined
    )
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('getFeatureFlagResult falls back to server when bucketing_identifier is device_id and $device_id is missing', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Device Flag',
          key: 'device-id-flag',
          bucketing_identifier: 'device_id',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
      ],
    }

    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'device-id-flag': 'flags-fallback-value' },
        flagsPayloads: { 'device-id-flag': 'fallback-payload' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const result = await posthog.getFeatureFlagResult('device-id-flag', 'some-distinct-id')
    expect(result).toMatchObject({
      key: 'device-id-flag',
      enabled: true,
      variant: 'flags-fallback-value',
      payload: 'fallback-payload',
    })
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('getFeatureFlagResult does not fallback to server for missing $device_id when onlyEvaluateLocally is true', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Device Flag',
          key: 'device-id-flag',
          bucketing_identifier: 'device_id',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
      ],
    }

    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'device-id-flag': 'flags-fallback-value' },
        flagsPayloads: { 'device-id-flag': 'fallback-payload' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const result = await posthog.getFeatureFlagResult('device-id-flag', 'some-distinct-id', {
      onlyEvaluateLocally: true,
    })
    expect(result).toBeUndefined()
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('getFeatureFlagPayload falls back to server when bucketing_identifier is device_id and $device_id is missing', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Device Flag',
          key: 'device-id-flag',
          bucketing_identifier: 'device_id',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
            payloads: { true: 'local-payload' },
          },
        },
      ],
    }

    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'device-id-flag': 'flags-fallback-value' },
        flagsPayloads: { 'device-id-flag': 'fallback-payload' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const payload = await posthog.getFeatureFlagPayload('device-id-flag', 'some-distinct-id')
    expect(payload).toEqual('fallback-payload')
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('getFeatureFlagPayload does not fallback to server for missing $device_id when onlyEvaluateLocally is true', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Device Flag',
          key: 'device-id-flag',
          bucketing_identifier: 'device_id',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
            payloads: { true: 'local-payload' },
          },
        },
      ],
    }

    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'device-id-flag': 'flags-fallback-value' },
        flagsPayloads: { 'device-id-flag': 'fallback-payload' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const payload = await posthog.getFeatureFlagPayload('device-id-flag', 'some-distinct-id', undefined, {
      onlyEvaluateLocally: true,
    })
    expect(payload).toBeUndefined()
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('uses $device_id for bucketing when bucketing_identifier is device_id', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Device Bucketing Flag',
          key: 'complex-flag',
          bucketing_identifier: 'device_id',
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 30 }],
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

    const sharedDeviceId = 'some-distinct-id_within_rollout?'

    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id_within_rollout?', {
        personProperties: { $device_id: sharedDeviceId },
      })
    ).toEqual(true)

    expect(
      await posthog.getFeatureFlag('complex-flag', 'some-distinct-id_outside_rollout?', {
        personProperties: { $device_id: sharedDeviceId },
      })
    ).toEqual(true)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('treats null and empty bucketing_identifier as distinct_id', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Null Bucketing Identifier',
          key: 'null-bucketing-identifier-flag',
          bucketing_identifier: null,
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
        {
          id: 2,
          name: 'Empty Bucketing Identifier',
          key: 'empty-bucketing-identifier-flag',
          bucketing_identifier: '',
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

    expect(await posthog.getFeatureFlag('null-bucketing-identifier-flag', 'some-distinct-id')).toEqual(true)
    expect(await posthog.getFeatureFlag('empty-bucketing-identifier-flag', 'some-distinct-id')).toEqual(true)
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
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

  it('evaluates conditions in user defined order', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Test Feature',
          key: 'test-feature',
          active: true,
          filters: {
            groups: [
              {
                rollout_percentage: 100,
              },
              {
                properties: [
                  {
                    key: 'email',
                    operator: 'exact',
                    value: 'override@example.com',
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
                variant: 'override-variant',
              },
            ],
            multivariate: {
              variants: [
                {
                  key: 'default-variant',
                  name: 'Default Variant',
                  rollout_percentage: 100,
                },
                {
                  key: 'override-variant',
                  name: 'Override Variant',
                  rollout_percentage: 0,
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

    // Even though the person has the email that would trigger the override variant,
    // they should get the result from the first matching condition (which matches everyone)
    const result = await posthog.getFeatureFlag('test-feature', 'test_id', {
      personProperties: { email: 'override@example.com' },
    })

    expect('default-variant').toEqual(result)
    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
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

  it('should fallback to API when flag has multiple conditions and one contains static cohort', async () => {
    // When a flag has multiple conditions and one condition contains a static cohort
    // (cohort not available for local evaluation), the entire flag evaluation should
    // fallback to the API, regardless of whether other conditions could match locally.
    //
    // Customer scenario: Flag has:
    // - Condition 1: Static cohort check (would return "set-1" on server)
    // - Condition 2: Simple property check (could match locally and return "set-8")
    //
    // Expected: Should fallback to API and return "set-1"

    const flags = {
      flags: [
        {
          id: 1,
          name: 'Multi-condition Flag',
          key: 'default-pinned-mini-apps',
          active: true,
          filters: {
            groups: [
              {
                // First condition: Contains a static cohort (cohort 999 is NOT in the cohorts map)
                // This should cause the entire flag to fallback to API
                properties: [{ key: 'id', value: 999, type: 'cohort' }],
                rollout_percentage: 100,
                variant: 'set-1',
              },
              {
                // Second condition: Simple property check
                properties: [
                  {
                    key: '$geoip_country_code',
                    operator: 'exact',
                    value: ['DE'],
                    type: 'person',
                  },
                ],
                rollout_percentage: 100,
                variant: 'set-8',
              },
            ],
            multivariate: {
              variants: [
                { key: 'set-1', rollout_percentage: 50 },
                { key: 'set-8', rollout_percentage: 50 },
              ],
            },
          },
        },
      ],
      // Note: cohorts map does NOT contain cohort 999, making it a "static cohort"
      // that requires server-side database lookup
      cohorts: {},
    }

    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        // The /flags API returns 'set-1' because the user is in the static cohort
        decideFlags: { 'default-pinned-mini-apps': 'set-1' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    const result = await posthog.getFeatureFlag('default-pinned-mini-apps', 'test-distinct-id', {
      personProperties: {
        $geoip_country_code: 'DE',
      },
    })

    // Should return the correct variant from the API
    expect(result).toEqual('set-1')

    // Should call the /flags API because of the static cohort in first condition
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('should fallback to API when getFeatureFlagPayload evaluates flag with static cohort (no matchValue)', async () => {
    // When getFeatureFlagPayload is called WITHOUT a matchValue, it evaluates the flag.
    // If the flag has static cohorts, evaluation throws RequiresServerEvaluation.

    const flags = {
      flags: [
        {
          id: 1,
          name: 'Multi-condition Flag',
          key: 'default-pinned-mini-apps',
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: 'id', value: 999, type: 'cohort' }],
                rollout_percentage: 100,
                variant: 'set-1',
              },
            ],
            multivariate: {
              variants: [{ key: 'set-1', rollout_percentage: 100 }],
            },
            payloads: {
              'set-1': 'local-payload',
            },
          },
        },
      ],
      cohorts: {}, // cohort 999 not present = static cohort
    }

    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
        decideFlags: { 'default-pinned-mini-apps': 'set-1' },
        flagsPayloads: { 'default-pinned-mini-apps': 'api-payload' },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // Call WITHOUT matchValue - should evaluate the flag and throw RequiresServerEvaluation
    const result = await posthog.getFeatureFlagPayload('default-pinned-mini-apps', 'test-distinct-id', undefined, {
      personProperties: {},
    })

    // Should return payload from API
    expect(result).toEqual('api-payload')
    // Should have called the /flags API
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('should return local payload when getFeatureFlagPayload called with matchValue', async () => {
    // When getFeatureFlagPayload is called WITH a matchValue, it should:
    // 1. Skip flag evaluation
    // 2. Look up the payload locally
    // 3. Return it without calling the API

    const flags = {
      flags: [
        {
          id: 1,
          name: 'Flag with payload',
          key: 'test-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
                variant: 'variant-a',
              },
            ],
            multivariate: {
              variants: [{ key: 'variant-a', rollout_percentage: 100 }],
            },
            payloads: {
              'variant-a': 'local-payload-a',
            },
          },
        },
      ],
      cohorts: {},
    }

    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags: flags,
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      ...posthogImmediateResolveOptions,
    })

    // Call WITH matchValue - should use it to look up local payload
    const result = await posthog.getFeatureFlagPayload('test-flag', 'test-distinct-id', 'variant-a')

    // Should return local payload
    expect(result).toEqual('local-payload-a')
    // Should NOT have called the /flags API (only /decide for initial load)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
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

  it('should include $feature_flag_id and $feature_flag_reason for locally evaluated flags', async () => {
    const flags = {
      flags: [
        {
          id: 42,
          name: 'Test Feature',
          key: 'test-flag',
          active: true,
          filters: {
            groups: [{ rollout_percentage: 100 }],
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

    await posthog.getFeatureFlag('test-flag', 'some-distinct-id')
    await waitForPromises()

    expect(capturedMessage).toMatchObject({
      event: '$feature_flag_called',
      properties: {
        $feature_flag: 'test-flag',
        $feature_flag_response: true,
        $feature_flag_id: 42,
        $feature_flag_reason: 'Evaluated locally',
        locally_evaluated: true,
      },
    })

    await posthog.shutdown()
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

  afterEach(async () => {
    await posthog.shutdown()
  })

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

describe('fetch context handling', () => {
  it('should call fetch without bound context to avoid illegal invocation errors in edge environments', async () => {
    let fetchContext: any
    const mockFetch = jest.fn(function (this: any, ..._args: unknown[]) {
      fetchContext = this
      return Promise.resolve(
        new Response(
          JSON.stringify({
            flags: [],
            featureFlagPayloads: {},
          })
        )
      )
    })

    const posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      ...posthogImmediateResolveOptions,
    })

    await posthog.reloadFeatureFlags()
    expect(mockFetch).toHaveBeenCalled()
    expect(fetchContext).toBeUndefined()
  })
})

describe('ETag support for local evaluation polling', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('stores ETag from response and sends it on subsequent requests', async () => {
    const flags = {
      flags: [{ id: 1, key: 'test-flag', active: true }],
      group_type_mapping: {},
      cohorts: {},
    }

    // Track all fetch calls
    const fetchCalls: { url: string; options: any }[] = []
    const mockFetch = jest.fn((url: string, options: any) => {
      fetchCalls.push({ url, options })
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve(flags),
        headers: {
          get: (name: string) => (name === 'ETag' ? '"abc123"' : null),
        },
      })
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      ...posthogImmediateResolveOptions,
    })

    // Wait for initial load
    await waitForPromises()

    // First call should not have If-None-Match header
    expect(fetchCalls[0].options.headers['If-None-Match']).toBeUndefined()

    // Trigger a reload
    await posthog.reloadFeatureFlags()
    await waitForPromises()

    // Second call should have If-None-Match header with the ETag
    expect(fetchCalls[1].options.headers['If-None-Match']).toBe('"abc123"')
  })

  it('handles 304 Not Modified response by keeping cached flags', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          key: 'test-flag',
          active: true,
          filters: {
            groups: [{ rollout_percentage: 100 }],
          },
        },
      ],
      group_type_mapping: {},
      cohorts: {},
    }

    // Track all fetch calls to verify headers
    const fetchCalls: { url: string; options: any }[] = []
    let callCount = 0
    const mockFetch = jest.fn((url: string, options: any) => {
      fetchCalls.push({ url, options })
      callCount++
      if (callCount === 1) {
        // First call: return full response with ETag
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve(flags),
          headers: {
            get: (name: string) => (name === 'ETag' ? '"test-etag"' : null),
          },
        })
      } else {
        // Second call: return 304 Not Modified
        return Promise.resolve({
          status: 304,
          text: () => Promise.resolve(''),
          json: () => Promise.reject(new Error('No body on 304')),
          headers: {
            get: (name: string) => (name === 'ETag' ? '"test-etag"' : null),
          },
        })
      }
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      ...posthogImmediateResolveOptions,
    })

    // Wait for initial load
    await waitForPromises()

    // First call should not have If-None-Match header
    expect(fetchCalls[0].options.headers['If-None-Match']).toBeUndefined()

    // Verify flags were loaded
    const flag1 = await posthog.getFeatureFlag('test-flag', 'user-1')
    expect(flag1).toBe(true)

    // Trigger a reload (should get 304)
    await posthog.reloadFeatureFlags()
    await waitForPromises()

    // Verify the request that triggered 304 included the If-None-Match header
    expect(fetchCalls[1].options.headers['If-None-Match']).toBe('"test-etag"')

    // Verify flags are still available after 304
    const flag2 = await posthog.getFeatureFlag('test-flag', 'user-1')
    expect(flag2).toBe(true)

    // Verify fetch was called twice
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('updates ETag when flags change', async () => {
    let callCount = 0
    const mockFetch = jest.fn(() => {
      callCount++
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () =>
          Promise.resolve({
            flags: [{ id: 1, key: `flag-v${callCount}`, active: true }],
            group_type_mapping: {},
            cohorts: {},
          }),
        headers: {
          get: (name: string) => (name === 'ETag' ? `"etag-v${callCount}"` : null),
        },
      })
    })

    const fetchCalls: { url: string; options: any }[] = []
    const wrappedFetch = jest.fn((url: string, options: any) => {
      fetchCalls.push({ url, options })
      return mockFetch()
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: wrappedFetch,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()

    // First call - no ETag
    expect(fetchCalls[0].options.headers['If-None-Match']).toBeUndefined()

    // Second call
    await posthog.reloadFeatureFlags()
    await waitForPromises()
    expect(fetchCalls[1].options.headers['If-None-Match']).toBe('"etag-v1"')

    // Third call
    await posthog.reloadFeatureFlags()
    await waitForPromises()
    expect(fetchCalls[2].options.headers['If-None-Match']).toBe('"etag-v2"')
  })

  it('clears ETag when server stops sending it', async () => {
    let callCount = 0
    const mockFetch = jest.fn(() => {
      callCount++
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () =>
          Promise.resolve({
            flags: [{ id: 1, key: 'test-flag', active: true }],
            group_type_mapping: {},
            cohorts: {},
          }),
        headers: {
          // Only return ETag on first call
          get: (name: string) => (name === 'ETag' && callCount === 1 ? '"initial-etag"' : null),
        },
      })
    })

    const fetchCalls: { url: string; options: any }[] = []
    const wrappedFetch = jest.fn((url: string, options: any) => {
      fetchCalls.push({ url, options })
      return mockFetch()
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: wrappedFetch,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()

    // Second call should have the ETag from first response
    await posthog.reloadFeatureFlags()
    await waitForPromises()
    expect(fetchCalls[1].options.headers['If-None-Match']).toBe('"initial-etag"')

    // Third call should not have ETag (server stopped sending it)
    await posthog.reloadFeatureFlags()
    await waitForPromises()
    expect(fetchCalls[2].options.headers['If-None-Match']).toBeUndefined()
  })

  it('resets backoff on 304 response', async () => {
    let callCount = 0
    const mockFetch = jest.fn(() => {
      callCount++
      if (callCount === 1) {
        // First call: return full response
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () =>
            Promise.resolve({
              flags: [
                {
                  id: 1,
                  key: 'test-flag',
                  active: true,
                  filters: {
                    groups: [{ rollout_percentage: 100 }],
                  },
                },
              ],
              group_type_mapping: {},
              cohorts: {},
            }),
          headers: {
            get: (name: string) => (name === 'ETag' ? '"test-etag"' : null),
          },
        })
      } else {
        // Subsequent calls: return 304
        return Promise.resolve({
          status: 304,
          text: () => Promise.resolve(''),
          json: () => Promise.reject(new Error('No body on 304')),
          headers: {
            get: () => null,
          },
        })
      }
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()

    // Multiple 304 responses should not cause any issues
    await posthog.reloadFeatureFlags()
    await waitForPromises()
    await posthog.reloadFeatureFlags()
    await waitForPromises()

    expect(mockFetch).toHaveBeenCalledTimes(3)

    // Flags should still work
    const flag = await posthog.getFeatureFlag('test-flag', 'user-1')
    expect(flag).toBe(true)
  })

  it('updates ETag when server sends new ETag with 304 response', async () => {
    let callCount = 0
    const fetchCalls: { url: string; options: any }[] = []
    const mockFetch = jest.fn((url: string, options: any) => {
      fetchCalls.push({ url, options })
      callCount++
      if (callCount === 1) {
        // First call: return full response with initial ETag
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () =>
            Promise.resolve({
              flags: [{ id: 1, key: 'test-flag', active: true }],
              group_type_mapping: {},
              cohorts: {},
            }),
          headers: {
            get: (name: string) => (name === 'ETag' ? '"etag-v1"' : null),
          },
        })
      } else if (callCount === 2) {
        // Second call: return 304 with updated ETag
        return Promise.resolve({
          status: 304,
          text: () => Promise.resolve(''),
          json: () => Promise.reject(new Error('No body on 304')),
          headers: {
            get: (name: string) => (name === 'ETag' ? '"etag-v2"' : null),
          },
        })
      } else {
        // Third call: return 304
        return Promise.resolve({
          status: 304,
          text: () => Promise.resolve(''),
          json: () => Promise.reject(new Error('No body on 304')),
          headers: {
            get: () => null,
          },
        })
      }
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()

    // First call has no ETag
    expect(fetchCalls[0].options.headers['If-None-Match']).toBeUndefined()

    // Second call uses initial ETag
    await posthog.reloadFeatureFlags()
    await waitForPromises()
    expect(fetchCalls[1].options.headers['If-None-Match']).toBe('"etag-v1"')

    // Third call should use the updated ETag from the 304 response
    await posthog.reloadFeatureFlags()
    await waitForPromises()
    expect(fetchCalls[2].options.headers['If-None-Match']).toBe('"etag-v2"')
  })
})

describe('error handling and backoff', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  afterEach(async () => {
    await posthog.shutdown()
  })

  /**
   * Helper to create a mock fetch that returns a specific status code for flag requests.
   * Returns 200 for all other endpoints.
   */
  function createMockFetch(statusCode: number, onFlagFetch?: () => void): jest.Mock & { callCount: number } {
    let callCount = 0
    const mockFetch = jest.fn((url: string) => {
      if ((url as string).includes('api/feature_flag/local_evaluation')) {
        callCount++
        onFlagFetch?.()
        return Promise.resolve({
          status: statusCode,
          text: () => Promise.resolve(statusCode === 401 ? 'Unauthorized' : 'Error'),
          json: () => Promise.resolve({ error: 'Error' }),
          headers: {
            get: () => null,
          },
        })
      }

      // Handle other endpoints (batch, etc.)
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve({ status: 'ok' }),
      })
    }) as jest.Mock & { callCount: number }

    Object.defineProperty(mockFetch, 'callCount', {
      get: () => callCount,
    })

    return mockFetch
  }

  it('should block on-demand fetches during backoff period after 401', async () => {
    const mockFetch = createMockFetch(401)

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      featureFlagsPollingInterval: 30000,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()
    expect(mockFetch.callCount).toBe(1)

    // On-demand fetches should be blocked during backoff
    await posthog.getFeatureFlag('test-flag', 'user-1')
    await waitForPromises()
    await posthog.getFeatureFlag('test-flag', 'user-2')
    await waitForPromises()
    await posthog.getFeatureFlag('test-flag', 'user-3')
    await waitForPromises()

    expect(mockFetch.callCount).toBe(1)
  })

  it('should block on-demand fetches during backoff period after 403', async () => {
    const mockFetch = createMockFetch(403)

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      featureFlagsPollingInterval: 30000,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()
    expect(mockFetch.callCount).toBe(1)

    // On-demand fetches should be blocked during backoff
    await posthog.getFeatureFlag('test-flag', 'user-1')
    await waitForPromises()
    await posthog.getFeatureFlag('test-flag', 'user-2')
    await waitForPromises()

    expect(mockFetch.callCount).toBe(1)
  })

  it('should block on-demand fetches during backoff period after 429', async () => {
    const mockFetch = createMockFetch(429)

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      featureFlagsPollingInterval: 30000,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()
    expect(mockFetch.callCount).toBe(1)

    // On-demand fetches should be blocked during backoff
    await posthog.getFeatureFlag('test-flag', 'user-1')
    await waitForPromises()
    await posthog.getFeatureFlag('test-flag', 'user-2')
    await waitForPromises()

    expect(mockFetch.callCount).toBe(1)
  })

  it('should allow on-demand fetches after backoff period expires', async () => {
    // Use real timers for this test to avoid jest.useFakeTimers() resetting Date.now mock
    jest.useRealTimers()

    let fetchCallCount = 0
    // Track time to simulate time passing
    let mockTime = Date.now()
    const originalDateNow = Date.now
    Date.now = () => mockTime

    const mockFetch = jest.fn((url: string) => {
      if ((url as string).includes('api/feature_flag/local_evaluation')) {
        fetchCallCount++
        // Always return 401 to keep triggering backoff
        return Promise.resolve({
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
          json: () => Promise.resolve({ error: 'Invalid API key' }),
          headers: {
            get: () => null,
          },
        })
      }
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve({ status: 'ok' }),
      })
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      featureFlagsPollingInterval: 1000, // Use small interval for faster test
      ...posthogImmediateResolveOptions,
    })

    // Wait for initial fetch with a short delay
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchCallCount).toBe(1)

    // On-demand fetch should be blocked during backoff
    await posthog.getFeatureFlag('test-flag', 'user-1')
    expect(fetchCallCount).toBe(1)

    // Advance mock time past the exponential backoff period
    // After first 401: backOffCount=1, interval = min(60000, 1000 * 2^1) = 2000ms
    mockTime += 2001

    // Now on-demand fetch should be allowed (backoff expired based on Date.now())
    await posthog.getFeatureFlag('test-flag', 'user-2')

    // fetchCallCount should be 2 (on-demand fetch was allowed after backoff expired)
    expect(fetchCallCount).toBe(2)

    // Restore Date.now and fake timers
    Date.now = originalDateNow
    jest.useFakeTimers()
  })

  it('should increase backoff intervals exponentially (2s → 4s → 8s)', async () => {
    // Verifies exponential backoff: interval = min(60s, baseInterval * 2^backoffCount)
    // With baseInterval=1000ms: 2000ms → 4000ms → 8000ms
    jest.useRealTimers()

    let fetchCallCount = 0
    let mockTime = Date.now()
    const originalDateNow = Date.now
    Date.now = () => mockTime

    const mockFetch = jest.fn((url: string) => {
      if ((url as string).includes('api/feature_flag/local_evaluation')) {
        fetchCallCount++
        return Promise.resolve({
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
          json: () => Promise.resolve({ error: 'Invalid API key' }),
          headers: { get: () => null },
        })
      }
      return Promise.resolve({ status: 200, text: () => Promise.resolve('ok'), json: () => Promise.resolve({}) })
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      featureFlagsPollingInterval: 1000,
      ...posthogImmediateResolveOptions,
    })

    await new Promise((r) => setTimeout(r, 50))
    expect(fetchCallCount).toBe(1) // Initial fetch, backoff = 2s

    // Advance past 2s backoff, trigger second error
    mockTime += 2001
    await posthog.getFeatureFlag('test', 'user')
    expect(fetchCallCount).toBe(2) // backoff now = 4s

    // 2s is NOT enough anymore
    mockTime += 2001
    await posthog.getFeatureFlag('test', 'user')
    expect(fetchCallCount).toBe(2) // Still blocked

    // 4s total is enough
    mockTime += 2000
    await posthog.getFeatureFlag('test', 'user')
    expect(fetchCallCount).toBe(3) // backoff now = 8s

    // 4s is NOT enough anymore
    mockTime += 4001
    await posthog.getFeatureFlag('test', 'user')
    expect(fetchCallCount).toBe(3) // Still blocked

    // 8s total is enough
    mockTime += 4000
    await posthog.getFeatureFlag('test', 'user')
    expect(fetchCallCount).toBe(4) // Exponential backoff verified!

    Date.now = originalDateNow
    jest.useFakeTimers()
  })

  it('should clear backoff after successful response', async () => {
    let fetchCallCount = 0
    const mockFetch = jest.fn((url: string) => {
      if ((url as string).includes('api/feature_flag/local_evaluation')) {
        fetchCallCount++
        if (fetchCallCount === 1) {
          // First fetch: return 401 to trigger backoff
          return Promise.resolve({
            status: 401,
            text: () => Promise.resolve('Unauthorized'),
            json: () => Promise.resolve({ error: 'Invalid API key' }),
            headers: {
              get: () => null,
            },
          })
        } else {
          // Subsequent fetches: return 200 success
          return Promise.resolve({
            status: 200,
            json: () =>
              Promise.resolve({
                flags: [{ id: 1, key: 'test-flag', active: true, filters: { groups: [] } }],
                group_type_mapping: {},
                cohorts: {},
              }),
            headers: {
              get: () => null,
            },
          })
        }
      }
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve({ status: 'ok' }),
      })
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      featureFlagsPollingInterval: 30000,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()
    expect(fetchCallCount).toBe(1) // Initial 401

    // Use reloadFeatureFlags to trigger a retry (uses forceReload=true, bypasses backoff)
    await posthog.reloadFeatureFlags()
    await waitForPromises()
    expect(fetchCallCount).toBe(2) // Retry succeeded with 200

    // Now on-demand fetch should work immediately (backoff cleared by 200 response)
    await posthog.getFeatureFlag('test-flag', 'user-1')
    await waitForPromises()

    // The getFeatureFlag call should not trigger another fetch because
    // loadedSuccessfullyOnce is now true (flags loaded successfully)
    // This verifies the backoff was cleared and normal operation resumed
    expect(fetchCallCount).toBe(2)
  })

  it('should allow reloadFeatureFlags() to bypass backoff', async () => {
    let fetchCallCount = 0
    const mockFetch = jest.fn((url: string) => {
      if ((url as string).includes('api/feature_flag/local_evaluation')) {
        fetchCallCount++
        // Always return 401 to keep backoff active
        return Promise.resolve({
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
          json: () => Promise.resolve({ error: 'Invalid API key' }),
          headers: {
            get: () => null,
          },
        })
      }
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('ok'),
        json: () => Promise.resolve({ status: 'ok' }),
      })
    })

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      fetch: mockFetch,
      featureFlagsPollingInterval: 30000,
      ...posthogImmediateResolveOptions,
    })

    await waitForPromises()
    expect(fetchCallCount).toBe(1) // Initial fetch

    // On-demand fetch should be blocked
    await posthog.getFeatureFlag('test-flag', 'user-1')
    await waitForPromises()
    expect(fetchCallCount).toBe(1) // Still blocked

    // reloadFeatureFlags uses forceReload=true internally, should bypass backoff
    await posthog.reloadFeatureFlags()
    await waitForPromises()

    // reloadFeatureFlags should have bypassed backoff and made a new fetch
    expect(fetchCallCount).toBe(2)

    // On-demand fetch should still be blocked (new backoff started after 401)
    await posthog.getFeatureFlag('test-flag', 'user-2')
    await waitForPromises()
    expect(fetchCallCount).toBe(2) // Still blocked
  })
})

describe('experience continuity warning', () => {
  let posthog: PostHog
  let warnSpy: jest.SpyInstance

  jest.useFakeTimers()

  beforeEach(() => {
    mockedFetch.mockClear()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await posthog.shutdown()
  })

  it('emits warning when experience continuity flags are detected', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Normal Flag',
          key: 'normal-flag',
          active: true,
          ensure_experience_continuity: false,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
        {
          id: 2,
          name: 'Exp Cont Flag',
          key: 'exp-cont-flag',
          active: true,
          ensure_experience_continuity: true,
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

    await jest.runOnlyPendingTimersAsync()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exp-cont-flag'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('experience continuity'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('incompatible with local evaluation'))
  })

  it('does not emit warning when no experience continuity flags exist', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Normal Flag',
          key: 'normal-flag',
          active: true,
          ensure_experience_continuity: false,
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

    await jest.runOnlyPendingTimersAsync()

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('includes all experience continuity flag keys in warning', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Exp Cont Flag 1',
          key: 'exp-cont-flag-1',
          active: true,
          ensure_experience_continuity: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
        {
          id: 2,
          name: 'Exp Cont Flag 2',
          key: 'exp-cont-flag-2',
          active: true,
          ensure_experience_continuity: true,
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

    await jest.runOnlyPendingTimersAsync()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exp-cont-flag-1'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('exp-cont-flag-2'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2 flag(s)'))
  })

  it('does not emit warning when strictLocalEvaluation is enabled', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Exp Cont Flag',
          key: 'exp-cont-flag',
          active: true,
          ensure_experience_continuity: true,
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
      strictLocalEvaluation: true,
      ...posthogImmediateResolveOptions,
    })

    await jest.runOnlyPendingTimersAsync()

    // Warning should NOT be emitted because strictLocalEvaluation prevents server fallback
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('strictLocalEvaluation option', () => {
  let posthog: PostHog
  let warnSpy: jest.SpyInstance

  jest.useFakeTimers()

  beforeEach(() => {
    mockedFetch.mockClear()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    await posthog.shutdown()
  })

  it('prevents server fallback for flags that cannot be evaluated locally', async () => {
    // Set up local flags that include an experience continuity flag
    const localFlags = {
      flags: [
        {
          id: 1,
          name: 'Exp Cont Flag',
          key: 'exp-cont-flag',
          active: true,
          ensure_experience_continuity: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
      ],
    }
    mockedFetch.mockImplementation(apiImplementation({ localFlags }))

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      strictLocalEvaluation: true,
      ...posthogImmediateResolveOptions,
    })

    await jest.runOnlyPendingTimersAsync()

    // Reset mock to track decide calls
    mockedFetch.mockClear()

    // This flag has experience continuity enabled, so local evaluation will throw InconclusiveMatchError
    // With strictLocalEvaluation: true, it should return undefined without calling the server
    const result = await posthog.getFeatureFlag('exp-cont-flag', 'user-123')

    expect(result).toBeUndefined()

    // Should NOT have made a /flags call (server fallback prevented)
    expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
  })

  it('allows per-call override of strictLocalEvaluation', async () => {
    const localFlags = {
      flags: [
        {
          id: 1,
          name: 'Exp Cont Flag',
          key: 'exp-cont-flag',
          active: true,
          ensure_experience_continuity: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
          },
        },
      ],
    }

    // Mock for both local flags and decide endpoint
    mockedFetch.mockImplementation(
      apiImplementation({
        localFlags,
        decideFlags: { 'exp-cont-flag': true },
      })
    )

    posthog = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      personalApiKey: 'TEST_PERSONAL_API_KEY',
      strictLocalEvaluation: true,
      ...posthogImmediateResolveOptions,
    })

    await jest.runOnlyPendingTimersAsync()
    mockedFetch.mockClear()

    // Override per-call to allow server fallback
    const result = await posthog.getFeatureFlag('exp-cont-flag', 'user-123', {
      onlyEvaluateLocally: false,
    })

    // Should have made a /flags call since we explicitly set onlyEvaluateLocally: false
    expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
    expect(result).toBe(true)
  })

  it('includes local evaluation timestamps functionality', async () => {
    const flags = {
      flags: [
        {
          id: 42,
          name: 'Simple Flag',
          key: 'simple-flag',
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

    // Wait for flags to load
    await jest.runOnlyPendingTimersAsync()

    // Verify flag definitions loaded timestamp is available
    const flagDefinitionsLoadedAt = posthog.featureFlagsPoller?.getFlagDefinitionsLoadedAt()
    expect(flagDefinitionsLoadedAt).toBeDefined()
    expect(typeof flagDefinitionsLoadedAt).toBe('number')
    expect(flagDefinitionsLoadedAt).toBeGreaterThan(0)

    // Create evaluation context to test timestamp caching
    const evaluationContext = {
      distinctId: 'user-123',
      groups: {},
      personProperties: {},
      groupProperties: {},
      evaluationCache: {},
      evaluationTimestampCache: {},
    }

    // Get feature flag to trigger evaluation timestamp caching
    const flag = posthog.featureFlagsPoller?.featureFlagsByKey['simple-flag']
    expect(flag).toBeDefined()

    if (flag && posthog.featureFlagsPoller) {
      const result = await posthog.featureFlagsPoller.computeFlagAndPayloadLocally(flag, evaluationContext)
      expect(result.value).toBe(true)

      // Check if evaluation timestamp was cached
      const flagEvaluatedAt = posthog.featureFlagsPoller.getFlagEvaluatedAt('simple-flag', evaluationContext)
      expect(flagEvaluatedAt).toBeDefined()
      expect(typeof flagEvaluatedAt).toBe('number')
      expect(flagEvaluatedAt).toBeGreaterThan(0)
    }
  })

  it('tracks flag definitions loaded timestamp', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Test Flag',
          key: 'test-flag',
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
      sendFeatureFlagEvent: true, // Explicitly enable feature flag events
      ...posthogImmediateResolveOptions,
    })

    // Wait for flags to load
    await jest.runOnlyPendingTimersAsync()

    // Check that flag definitions loaded timestamp is available
    const flagDefinitionsLoadedAt = posthog.featureFlagsPoller?.getFlagDefinitionsLoadedAt()
    expect(flagDefinitionsLoadedAt).toBeDefined()
    expect(typeof flagDefinitionsLoadedAt).toBe('number')
    expect(flagDefinitionsLoadedAt).toBeGreaterThan(0)
  })
})
