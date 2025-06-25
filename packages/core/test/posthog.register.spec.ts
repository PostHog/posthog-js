import { PostHogPersistedProperty } from '../src'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let mocks: PostHogCoreTestClientMocks

  const getEnrichedProperties = (): any => {
    // NOTE: Hacky override so we can just test the props functionality
    return (posthog as any).enrichProperties()
  }

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {})
  })

  describe('register', () => {
    it('should register properties to storage', () => {
      posthog.register({ foo: 'bar' })
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ foo: 'bar' })
      posthog.register({ foo2: 'bar2' })
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar', foo2: 'bar2' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ foo: 'bar', foo2: 'bar2' })
    })

    it('should unregister properties from storage', () => {
      posthog.register({ foo: 'bar', foo2: 'bar2' })
      posthog.unregister('foo')
      expect(getEnrichedProperties().foo).toBeUndefined()
      expect(getEnrichedProperties().foo2).toEqual('bar2')
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual({ foo2: 'bar2' })
    })

    it('should register properties only for the session', () => {
      posthog.registerForSession({ foo: 'bar' })
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar' })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Props)).toEqual(undefined)

      posthog.register({ foo: 'bar2' })
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar' })
      posthog.unregisterForSession('foo')
      expect(getEnrichedProperties()).toMatchObject({ foo: 'bar2' })
    })
  })
})
