import { PostHogPersistedProperty } from '../src'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 5 })
  })

  describe('optOut', () => {
    it('should be optedIn by default', async () => {
      expect(posthog.optedOut).toEqual(false)
    })

    it('should be able to init disabled', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { defaultOptIn: false })
      expect(posthog.optedOut).toEqual(true)
    })

    it('should opt in/out when called', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { defaultOptIn: false })
      posthog.optOut()
      expect(posthog.optedOut).toEqual(true)
      posthog.optIn()
      expect(posthog.optedOut).toEqual(false)
    })

    it('should persist enabled state when called', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { defaultOptIn: false })
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.OptedOut)).toEqual(undefined)
      posthog.optOut()
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.OptedOut)).toEqual(true)
      posthog.optIn()
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.OptedOut)).toEqual(false)
    })

    it('should start in the correct state', async () => {
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', { defaultOptIn: false }, (mocks) => {
        mocks.storage.setItem(PostHogPersistedProperty.OptedOut, true)
      })

      expect(posthog.optedOut).toEqual(true)
    })
  })
})
