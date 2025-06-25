import { PostHogPersistedProperty } from '../src'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let mocks: PostHogCoreTestClientMocks

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {})
  })

  describe('reset', () => {
    it('should reset the storage when called', () => {
      const distinctId = posthog.getDistinctId()
      posthog.overrideFeatureFlag({
        foo: 'bar',
      })
      posthog.register({
        prop: 1,
      })

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.AnonymousId)).toEqual(distinctId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags)).toEqual({ foo: 'bar' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ prop: 1 })

      posthog.reset()

      expect(posthog.getDistinctId()).not.toEqual(distinctId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags)).toEqual(undefined)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual(undefined)
    })

    it("shouldn't reset the events capture queue", async () => {
      posthog.getDistinctId()
      posthog.capture('custom-event')

      const expectedQueue = [
        {
          message: expect.objectContaining({
            event: 'custom-event',
            library: 'posthog-core-tests',
          }),
        },
      ]

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toEqual(expectedQueue)
      posthog.reset()

      const newDistinctId = posthog.getDistinctId()

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toEqual(expectedQueue)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.AnonymousId)).toEqual(newDistinctId)
    })

    it('should not reset specific props when set', () => {
      const distinctId = posthog.getDistinctId()
      posthog.overrideFeatureFlag({
        foo: 'bar',
      })
      posthog.register({
        prop: 1,
      })

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.AnonymousId)).toEqual(distinctId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags)).toEqual({ foo: 'bar' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ prop: 1 })

      posthog.reset([PostHogPersistedProperty.OverrideFeatureFlags])

      expect(posthog.getDistinctId()).not.toEqual(distinctId)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.OverrideFeatureFlags)).toEqual({ foo: 'bar' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual(undefined)
    })
  })
})
