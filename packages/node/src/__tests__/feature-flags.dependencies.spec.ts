import { PostHogOptions } from '@/types'
import { PostHog } from '@/entrypoints/index.node'
import { anyFlagsCall, anyLocalEvalCall, apiImplementation } from './utils'

jest.spyOn(console, 'debug').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const posthogImmediateResolveOptions: PostHogOptions = {
  fetchRetryCount: 0,
}

type LocalPostHog = Omit<PostHog, 'featureFlagsPoller'> & {
  featureFlagsPoller: PostHog['featureFlagsPoller']
}

function buildClient(options: Partial<PostHogOptions> = posthogImmediateResolveOptions): LocalPostHog {
  return new PostHog('TEST_API_KEY', {
    host: 'http://example.com',
    personalApiKey: 'TEST_PERSONAL_API_KEY',
    ...options,
  }) as unknown as LocalPostHog
}

describe('feature flag dependencies', () => {
  let posthog: LocalPostHog

  jest.useFakeTimers()

  afterEach(async () => {
    // ensure clean shutdown & no test interdependencies
    await posthog.shutdown()
  })

  describe('flag dependencies', () => {
    it('evaluates simple flag dependency', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Base Flag',
            key: 'base-flag',
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
            name: 'Dependent Flag',
            key: 'dependent-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'base-flag',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['base-flag'],
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

      posthog = buildClient()

      expect(await posthog.getFeatureFlag('dependent-flag', 'distinct-id')).toEqual(true)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('ignores bucketing_identifier on group flags when evaluating dependencies', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Group Base Flag',
            key: 'group-base-flag',
            bucketing_identifier: 'device_id',
            active: true,
            filters: {
              aggregation_group_type_index: 0,
              groups: [{ properties: [], rollout_percentage: 100 }],
            },
          },
          {
            id: 2,
            name: 'Dependent Flag',
            key: 'dependent-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'group-base-flag',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['group-base-flag'],
                    },
                  ],
                  rollout_percentage: 100,
                },
              ],
            },
          },
        ],
        group_type_mapping: { '0': 'company' },
      }
      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

      posthog = buildClient()

      expect(await posthog.getFeatureFlag('dependent-flag', 'distinct-id')).toEqual(true)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
      expect(mockedFetch).not.toHaveBeenCalledWith(...anyFlagsCall)
    })

    it('evaluates true when expected true but flag returns variant', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Base Multivariate Flag',
            key: 'multivariate-leaf-flag',
            active: true,
            filters: {
              multivariate: {
                variants: [
                  { key: 'pineapple', rollout_percentage: 25 },
                  { key: 'mango', rollout_percentage: 25 },
                  { key: 'papaya', rollout_percentage: 25 },
                  { key: 'kiwi', rollout_percentage: 25 },
                ],
              },
              groups: [
                {
                  properties: [
                    {
                      key: 'email',
                      type: 'person',
                      value: '@example.com',
                      operator: 'icontains',
                    },
                  ],
                  rollout_percentage: 100,
                },
              ],
            },
          },
          {
            id: 2,
            name: 'Dependent Flag',
            key: 'dependent-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'multivariate-leaf-flag',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['multivariate-leaf-flag'],
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

      posthog = buildClient()

      expect(
        await posthog.getFeatureFlag('multivariate-leaf-flag', 'test-user', {
          personProperties: { email: 'anybody@example.com' },
        })
      ).toEqual('kiwi')

      expect(
        await posthog.getFeatureFlag('dependent-flag', 'test-user', {
          personProperties: { email: 'anybody@example.com' },
        })
      ).toEqual(true)

      const negativeLeafResult = await posthog.getFeatureFlag('multivariate-leaf-flag', 'test-user', {
        personProperties: { email: 'nobody@not-example.com' },
      })
      expect(negativeLeafResult).toEqual(false)

      expect(
        await posthog.getFeatureFlag('dependent-flag', 'test-user', {
          personProperties: { email: 'nobody@not-example.com' },
        })
      ).toEqual(false)
    })

    it('returns false when dependency flag is false', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Base Flag',
            key: 'base-flag',
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
            id: 2,
            name: 'Dependent Flag',
            key: 'dependent-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'base-flag',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['base-flag'],
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

      posthog = buildClient()

      expect(await posthog.getFeatureFlag('base-flag', 'distinct-id')).toEqual(false)
      expect(await posthog.getFeatureFlag('dependent-flag', 'distinct-id')).toEqual(false)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('returns undefined when dependency chain is empty (circular dependency)', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Base Flag',
            key: 'base-flag',
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
            name: 'Dependent Flag',
            key: 'dependent-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'base-flag',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: [], // Empty chain indicates circular dependency
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

      posthog = buildClient()

      expect(await posthog.getFeatureFlag('dependent-flag', 'distinct-id')).toEqual(undefined)
      expect(mockedFetch).toHaveBeenCalledWith(...anyFlagsCall)
    })

    it('returns undefined when dependency flag is missing', async () => {
      const flags = {
        flags: [
          {
            id: 2,
            name: 'Dependent Flag',
            key: 'dependent-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'missing-flag',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['missing-flag'],
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

      posthog = buildClient()

      expect(await posthog.getFeatureFlag('dependent-flag', 'distinct-id')).toBeUndefined()
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('evaluates multi-level flag dependencies (A→B→C)', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Flag A',
            key: 'flag-a',
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
            name: 'Flag B',
            key: 'flag-b',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'flag-a',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['flag-a'],
                    },
                  ],
                  rollout_percentage: 100,
                },
              ],
            },
          },
          {
            id: 3,
            name: 'Flag C',
            key: 'flag-c',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'flag-b',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['flag-a', 'flag-b'],
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

      posthog = buildClient()

      // flag-c depends on flag-b, which depends on flag-a - all should be true
      expect(await posthog.getFeatureFlag('flag-c', 'distinct-id')).toEqual(true)

      // Verify individual flags work as expected
      expect(await posthog.getFeatureFlag('flag-a', 'distinct-id')).toEqual(true)
      expect(await posthog.getFeatureFlag('flag-b', 'distinct-id')).toEqual(true)

      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('multi-level dependencies fail when base flag is disabled', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Flag A',
            key: 'flag-a',
            active: false, // Base flag disabled
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
            name: 'Flag B',
            key: 'flag-b',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'flag-a',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['flag-a'],
                    },
                  ],
                  rollout_percentage: 100,
                },
              ],
            },
          },
          {
            id: 3,
            name: 'Flag C',
            key: 'flag-c',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'flag-b',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['flag-a', 'flag-b'],
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

      posthog = buildClient()

      // When base flag (flag-a) is disabled, the whole chain should fail
      expect(await posthog.getFeatureFlag('flag-a', 'distinct-id')).toEqual(false)
      expect(await posthog.getFeatureFlag('flag-b', 'distinct-id')).toEqual(false)
      expect(await posthog.getFeatureFlag('flag-c', 'distinct-id')).toEqual(false)

      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('evaluates flag dependencies mixed with person properties', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Base Flag',
            key: 'base-flag',
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
            name: 'Mixed Conditions Flag',
            key: 'mixed-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'base-flag',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['base-flag'],
                    },
                    {
                      key: 'email',
                      type: 'person',
                      value: '@example.com',
                      operator: 'icontains',
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

      posthog = buildClient()

      // Both conditions satisfied
      expect(
        await posthog.getFeatureFlag('mixed-flag', 'user-1', {
          personProperties: { email: 'test@example.com' },
        })
      ).toEqual(true)

      // Flag dependency satisfied but email condition not satisfied
      expect(
        await posthog.getFeatureFlag('mixed-flag', 'user-2', {
          personProperties: { email: 'test@other.com' },
        })
      ).toEqual(false)

      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('evaluates flag dependency with boolean false value', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Base Flag',
            key: 'base-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [],
                  rollout_percentage: 0, // Always returns false
                },
              ],
            },
          },
          {
            id: 2,
            name: 'Dependent Flag',
            key: 'dependent-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'base-flag',
                      type: 'flag',
                      value: false,
                      operator: 'flag_evaluates_to', // Should match when base-flag is false
                      dependency_chain: ['base-flag'],
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

      posthog = buildClient()

      // base-flag returns false, so exact match with false should return true
      expect(await posthog.getFeatureFlag('dependent-flag', 'distinct-id')).toEqual(true)
      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('handles complex dependency chain with multiple flags', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Flag A',
            key: 'flag-a',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'email',
                      type: 'person',
                      value: '@example.com',
                      operator: 'icontains',
                    },
                  ],
                  rollout_percentage: 100,
                },
              ],
            },
          },
          {
            id: 2,
            name: 'Flag B',
            key: 'flag-b',
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
            id: 3,
            name: 'Flag C',
            key: 'flag-c',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'flag-a',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['flag-a'],
                    },
                    {
                      key: 'flag-b',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['flag-b'],
                    },
                  ],
                  rollout_percentage: 100,
                },
              ],
            },
          },
          {
            id: 4,
            name: 'Flag D',
            key: 'flag-d',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'flag-c',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['flag-a', 'flag-b', 'flag-c'],
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

      posthog = buildClient()

      // All dependencies satisfied - should return true
      expect(
        await posthog.getFeatureFlag('flag-d', 'distinct-id', {
          personProperties: { email: 'test@example.com' },
        })
      ).toEqual(true)

      // Break the chain by changing flag-a condition - should return false
      expect(
        await posthog.getFeatureFlag('flag-d', 'distinct-id', {
          personProperties: { email: 'test@other.com' },
        })
      ).toEqual(false)

      expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
    })

    it('should return undefined when flag dependencies are missing dependency_chain', async () => {
      const flags = {
        flags: [
          {
            id: 1,
            name: 'Dependent Feature',
            key: 'dependent-flag',
            active: true,
            filters: {
              groups: [
                {
                  properties: [
                    {
                      key: 'parent-flag',
                      type: 'flag',
                      value: true,
                      operator: 'flag_evaluates_to',
                      // Missing dependency_chain - this makes it an invalid flag dependency
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

      const posthog = buildClient()

      // Should return undefined since the dependency chain is missing (InconclusiveMatchError)
      const result = await posthog.getFeatureFlag('dependent-flag', 'some-distinct-id')
      expect(result).toBe(undefined)
    })

    it('evaluates production-style multivariate dependency chain', async () => {
      const flags = {
        flags: [
          {
            id: 451,
            name: 'Multivariate Leaf Flag (Base)',
            key: 'multivariate-leaf-flag',
            active: true,
            filters: {
              multivariate: {
                variants: [
                  { key: 'pineapple', rollout_percentage: 25 },
                  { key: 'mango', rollout_percentage: 25 },
                  { key: 'papaya', rollout_percentage: 25 },
                  { key: 'kiwi', rollout_percentage: 25 },
                ],
              },
              groups: [
                {
                  variant: 'pineapple',
                  properties: [
                    {
                      key: 'email',
                      type: 'person',
                      value: ['pineapple@example.com'],
                      operator: 'exact',
                    },
                  ],
                  rollout_percentage: 100,
                },
                {
                  variant: 'mango',
                  properties: [
                    {
                      key: 'email',
                      type: 'person',
                      value: ['mango@example.com'],
                      operator: 'exact',
                    },
                  ],
                  rollout_percentage: 100,
                },
                {
                  variant: 'papaya',
                  properties: [
                    {
                      key: 'email',
                      type: 'person',
                      value: ['papaya@example.com'],
                      operator: 'exact',
                    },
                  ],
                  rollout_percentage: 100,
                },
                {
                  variant: 'kiwi',
                  properties: [
                    {
                      key: 'email',
                      type: 'person',
                      value: ['kiwi@example.com'],
                      operator: 'exact',
                    },
                  ],
                  rollout_percentage: 100,
                },
                {
                  properties: [],
                  rollout_percentage: 0, // Force default to false for unknown emails
                },
              ],
            },
          },
          {
            id: 467,
            name: 'Multivariate Intermediate Flag (Depends on fruit)',
            key: 'multivariate-intermediate-flag',
            active: true,
            filters: {
              multivariate: {
                variants: [
                  { key: 'blue', rollout_percentage: 100 }, // Force blue when dependency satisfied
                  { key: 'red', rollout_percentage: 0 },
                  { key: 'green', rollout_percentage: 0 },
                  { key: 'black', rollout_percentage: 0 },
                ],
              },
              groups: [
                {
                  variant: 'blue',
                  properties: [
                    {
                      key: 'multivariate-leaf-flag',
                      type: 'flag',
                      value: 'pineapple',
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['multivariate-leaf-flag'],
                    },
                  ],
                  rollout_percentage: 100,
                },
                {
                  variant: 'red',
                  properties: [
                    {
                      key: 'multivariate-leaf-flag',
                      type: 'flag',
                      value: 'mango',
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['multivariate-leaf-flag'],
                    },
                  ],
                  rollout_percentage: 100,
                },
              ],
            },
          },
          {
            id: 468,
            name: 'Multivariate Root Flag (Depends on color)',
            key: 'multivariate-root-flag',
            active: true,
            filters: {
              multivariate: {
                variants: [
                  { key: 'breaking-bad', rollout_percentage: 100 }, // Force breaking-bad when dependency satisfied
                  { key: 'the-wire', rollout_percentage: 0 },
                  { key: 'game-of-thrones', rollout_percentage: 0 },
                  { key: 'the-expanse', rollout_percentage: 0 },
                ],
              },
              groups: [
                {
                  variant: 'breaking-bad',
                  properties: [
                    {
                      key: 'multivariate-intermediate-flag',
                      type: 'flag',
                      value: 'blue',
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['multivariate-leaf-flag', 'multivariate-intermediate-flag'],
                    },
                  ],
                  rollout_percentage: 100,
                },
                {
                  variant: 'the-wire',
                  properties: [
                    {
                      key: 'multivariate-intermediate-flag',
                      type: 'flag',
                      value: 'red',
                      operator: 'flag_evaluates_to',
                      dependency_chain: ['multivariate-leaf-flag', 'multivariate-intermediate-flag'],
                    },
                  ],
                  rollout_percentage: 100,
                },
              ],
            },
          },
        ],
        cohorts: {},
      }

      mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

      posthog = buildClient()

      // Test successful pineapple -> blue -> breaking-bad chain
      const leafResult = await posthog.getFeatureFlag('multivariate-leaf-flag', 'test-user', {
        personProperties: { email: 'pineapple@example.com' },
      })
      const intermediateResult = await posthog.getFeatureFlag('multivariate-intermediate-flag', 'test-user', {
        personProperties: { email: 'pineapple@example.com' },
      })
      const rootResult = await posthog.getFeatureFlag('multivariate-root-flag', 'test-user', {
        personProperties: { email: 'pineapple@example.com' },
      })

      expect(leafResult).toEqual('pineapple')
      expect(intermediateResult).toEqual('blue')
      expect(rootResult).toEqual('breaking-bad')

      // Test successful mango -> red -> the-wire chain
      const mangoLeafResult = await posthog.getFeatureFlag('multivariate-leaf-flag', 'test-user', {
        personProperties: { email: 'mango@example.com' },
      })
      const mangoIntermediateResult = await posthog.getFeatureFlag('multivariate-intermediate-flag', 'test-user', {
        personProperties: { email: 'mango@example.com' },
      })
      const mangoRootResult = await posthog.getFeatureFlag('multivariate-root-flag', 'test-user', {
        personProperties: { email: 'mango@example.com' },
      })

      expect(mangoLeafResult).toEqual('mango')
      expect(mangoIntermediateResult).toEqual('red')
      expect(mangoRootResult).toEqual('the-wire')

      // Test broken chain - user without matching email gets default/false results
      const unknownLeafResult = await posthog.getFeatureFlag('multivariate-leaf-flag', 'test-user', {
        personProperties: { email: 'unknown@example.com' },
      })
      const unknownIntermediateResult = await posthog.getFeatureFlag('multivariate-intermediate-flag', 'test-user', {
        personProperties: { email: 'unknown@example.com' },
      })
      const unknownRootResult = await posthog.getFeatureFlag('multivariate-root-flag', 'test-user', {
        personProperties: { email: 'unknown@example.com' },
      })

      expect(unknownLeafResult).toEqual(false) // No matching email -> null variant -> false
      expect(unknownIntermediateResult).toEqual(false) // Dependency not satisfied
      expect(unknownRootResult).toEqual(false) // Chain broken
    })
  })

  describe('flagEvaluatesToExpectedValue', () => {
    describe('string variant matches', () => {
      it('matches string exactly (case-sensitive)', async () => {
        // Create a minimal flag setup to access the method
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        // Access the private method for testing
        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue('control', 'control')).toBe(true)
        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue('Control', 'Control')).toBe(true)
      })

      it('does not match different cases', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue('control', 'Control')).toBe(false)
        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue('Control', 'CONTROL')).toBe(false)
      })

      it('does not match different strings', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue('control', 'test')).toBe(false)
      })
    })

    describe('boolean expected value with string flag value', () => {
      it('matches true when flag has any string variant (any variant is truthy)', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(true, 'control')).toBe(true)
        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(true, 'test')).toBe(true)
      })

      it('does not match false when flag has string variant', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(false, 'control')).toBe(false)
      })
    })

    describe('boolean matches boolean exactly', () => {
      it('matches true with true', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(true, true)).toBe(true)
      })

      it('matches false with false', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(false, false)).toBe(true)
      })

      it('does not match false with true', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(false, true)).toBe(false)
      })

      it('does not match true with false', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(true, false)).toBe(false)
      })
    })

    describe('empty string handling', () => {
      it('does not match true with empty string', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(true, '')).toBe(false)
      })

      it('does not match string with empty string', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue('control', '')).toBe(false)
      })
    })

    describe('type mismatches', () => {
      it('does not match number with string', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue(123, 'control')).toBe(false)
      })

      it('does not match string with boolean true', async () => {
        const flags = {
          flags: [
            {
              id: 1,
              name: 'Test Flag',
              key: 'test-flag',
              active: true,
              filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
            },
          ],
        }
        mockedFetch.mockImplementation(apiImplementation({ localFlags: flags }))

        posthog = buildClient()

        expect((posthog.featureFlagsPoller as any).flagEvaluatesToExpectedValue('control', true)).toBe(false)
      })
    })
  })
})
