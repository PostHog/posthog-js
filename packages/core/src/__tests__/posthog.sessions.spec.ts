import { PostHogPersistedProperty } from '@/types'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from '@/testing'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()
  jest.setSystemTime(new Date('2022-01-01T12:00:00'))

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 })
  })

  describe('sessions', () => {
    it('should create a sessionId if not set', () => {
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(undefined)
      posthog.capture('test')
      expect(mocks.storage.setItem).toHaveBeenCalledWith(PostHogPersistedProperty.SessionId, expect.any(String))
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(expect.any(String))
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp)).toEqual(Date.now())
    })

    it('should re-use existing sessionId', () => {
      posthog.setPersistedProperty(PostHogPersistedProperty.SessionId, 'test-session-id')
      const now = Date.now()
      posthog.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, now)
      posthog.setPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp, now)
      posthog.capture('test')
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual('test-session-id')
    })

    it('should generate new sessionId if expired', () => {
      jest.setSystemTime(new Date('2022-01-01T12:00:00'))
      posthog.capture('test')
      const sessionId = posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)

      // Check 29 minutes later
      jest.setSystemTime(new Date('2022-01-01T12:29:00'))
      posthog.capture('test')
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(sessionId)

      // Check another 29 minutes later
      jest.setSystemTime(new Date('2022-01-01T12:58:00'))
      posthog.capture('test')
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).toEqual(sessionId)

      // Check more than 30 minutes later
      jest.setSystemTime(new Date('2022-01-01T13:30:00'))
      posthog.capture('test')
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).not.toEqual(sessionId)
    })

    it('should reset sessionId if called', () => {
      posthog.capture('test')
      const sessionId = posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)

      posthog.resetSessionId()
      posthog.capture('test2')
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)).not.toEqual(sessionId)
    })
  })
})
