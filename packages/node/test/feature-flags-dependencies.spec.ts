import { PostHogOptions } from '../src/types'
import { PostHog } from '../src/entrypoints/index.node'
import { anyLocalEvalCall, apiImplementation } from './test-utils'
import { waitForPromises } from '@posthog/core/testing'

jest.spyOn(console, 'debug').mockImplementation()
jest.spyOn(console, 'warn').mockImplementation()

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const posthogImmediateResolveOptions: PostHogOptions = {
  fetchRetryCount: 0,
}

describe('flag dependencies', () => {
  let posthog: PostHog

  jest.useFakeTimers()

  afterEach(async () => {
    // ensure clean shutdown & no test interdependencies
    await posthog.shutdown()
  })

  it('should evaluate flags with simple dependencies', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Parent Flag',
          key: 'parent-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: 'email',
                    type: 'person',
                    value: 'test@example.com',
                    operator: 'exact',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Child Flag',
          key: 'child-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: '1', // Depends on parent-flag (id: 1)
                    type: 'flag',
                    value: true,
                    operator: 'exact',
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

    // Should evaluate parent flag as true and child flag as true
    expect(
      await posthog.getFeatureFlag('child-flag', 'test-user', {
        personProperties: { email: 'test@example.com' },
      })
    ).toEqual(true)

    // Parent flag should also be true
    expect(
      await posthog.getFeatureFlag('parent-flag', 'test-user', {
        personProperties: { email: 'test@example.com' },
      })
    ).toEqual(true)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })

  it('should evaluate flags with dependency chain', async () => {
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
                properties: [
                  {
                    key: 'tier',
                    type: 'person',
                    value: 'premium',
                    operator: 'exact',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 2,
          name: 'Middle Flag',
          key: 'middle-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: '1', // Depends on base-flag
                    type: 'flag',
                    value: true,
                    operator: 'exact',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 3,
          name: 'Top Flag',
          key: 'top-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: '2', // Depends on middle-flag
                    type: 'flag',
                    value: true,
                    operator: 'exact',
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

    // Should evaluate entire chain
    expect(
      await posthog.getFeatureFlag('top-flag', 'test-user', {
        personProperties: { tier: 'premium' },
      })
    ).toEqual(true)

    // When base condition fails, entire chain should fail
    expect(
      await posthog.getFeatureFlag('top-flag', 'test-user', {
        personProperties: { tier: 'basic' },
      })
    ).toEqual(false)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })

  it('should handle flag dependencies with variants', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Feature A',
          key: 'feature-a',
          active: true,
          filters: {
            groups: [
              {
                properties: [],
                rollout_percentage: 100,
              },
            ],
            multivariate: {
              variants: [
                { key: 'variant1', rollout_percentage: 50 },
                { key: 'variant2', rollout_percentage: 50 },
              ],
            },
          },
        },
        {
          id: 2,
          name: 'Feature B',
          key: 'feature-b',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: '1', // Depends on feature-a
                    type: 'flag',
                    value: 'variant1',
                    operator: 'exact',
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

    // Test with a user that should get variant1
    const result = await posthog.getFeatureFlag('feature-b', 'user-variant1')

    // The result depends on which variant feature-a returns
    // We can't predict exact result due to hashing, but it should be either true or false
    expect(typeof result).toBe('boolean')

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })

  it('should handle dependency on false flag value', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Disabled Flag',
          key: 'disabled-flag',
          active: false, // This flag is disabled
        },
        {
          id: 2,
          name: 'Depends on Disabled',
          key: 'depends-on-disabled',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: '1', // Depends on disabled-flag being false
                    type: 'flag',
                    value: false,
                    operator: 'exact',
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

    // Should return true because disabled-flag is false
    expect(await posthog.getFeatureFlag('depends-on-disabled', 'test-user')).toEqual(true)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })

  it('should handle circular dependencies gracefully', async () => {
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
                    key: '2', // Depends on flag-b
                    type: 'flag',
                    value: true,
                    operator: 'exact',
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
                properties: [
                  {
                    key: '1', // Depends on flag-a (circular!)
                    type: 'flag',
                    value: true,
                    operator: 'exact',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 3,
          name: 'Independent Flag',
          key: 'independent-flag',
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

    // Flags with circular dependencies should be removed and return undefined
    const resultA = await posthog.getFeatureFlag('flag-a', 'test-user')
    const resultB = await posthog.getFeatureFlag('flag-b', 'test-user')
    const resultIndependent = await posthog.getFeatureFlag('independent-flag', 'test-user')

    // Cyclic flags should be removed and return undefined
    expect(resultA).toBeUndefined()
    expect(resultB).toBeUndefined()

    // Independent flag should still work
    expect(resultIndependent).toBe(true)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })

  it('should evaluate getAllFlags with dependencies', async () => {
    const flags = {
      flags: [
        {
          id: 1,
          name: 'Independent Flag',
          key: 'independent-flag',
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
                    key: '1', // Depends on independent-flag
                    type: 'flag',
                    value: true,
                    operator: 'exact',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 3,
          name: 'Cyclic Flag A',
          key: 'cyclic-flag-a',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: '4', // Depends on cyclic-flag-b
                    type: 'flag',
                    value: true,
                    operator: 'exact',
                  },
                ],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          id: 4,
          name: 'Cyclic Flag B',
          key: 'cyclic-flag-b',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: '3', // Depends on cyclic-flag-a (circular!)
                    type: 'flag',
                    value: true,
                    operator: 'exact',
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

    const allFlags = await posthog.getAllFlags('test-user')

    expect(allFlags['independent-flag']).toBe(true)
    expect(allFlags['dependent-flag']).toBe(true)

    // Cyclic flags should be removed and not present in results
    expect(allFlags['cyclic-flag-a']).toBeUndefined()
    expect(allFlags['cyclic-flag-b']).toBeUndefined()

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })

  it('should handle missing dependency gracefully', async () => {
    const flags = {
      flags: [
        {
          id: 2,
          name: 'Orphaned Flag',
          key: 'orphaned-flag',
          active: true,
          filters: {
            groups: [
              {
                properties: [
                  {
                    key: '999', // Depends on non-existent flag
                    type: 'flag',
                    value: true,
                    operator: 'exact',
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

    // Should handle missing dependency without crashing
    const result = await posthog.getFeatureFlag('orphaned-flag', 'test-user')

    // Should return false since the dependency condition cannot be satisfied
    expect(result).toBe(false)

    expect(mockedFetch).toHaveBeenCalledWith(...anyLocalEvalCall)
  })
})
