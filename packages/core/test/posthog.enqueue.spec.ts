import { PostHogPersistedProperty } from '../src'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  beforeEach(() => {
    jest.setSystemTime(new Date('2022-01-01'))
  })

  function createSut(maxQueueSize: number = 1000, flushAt: number = 20): void {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
      maxQueueSize: maxQueueSize,
      flushAt: flushAt,
    })
  }

  describe('enqueue', () => {
    it('should add a message to the queue', () => {
      createSut()

      posthog.capture('type', {
        foo: 'bar',
      })

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toHaveLength(1)

      const item = posthog.getPersistedProperty<any[]>(PostHogPersistedProperty.Queue)?.pop()

      expect(item).toMatchObject({
        message: {
          library: 'posthog-core-tests',
          library_version: '2.0.0-alpha',
          type: 'capture',
          properties: {
            foo: 'bar',
          },
        },
      })

      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('should delete oldest message if queue is full', () => {
      createSut(2, 2)

      posthog.capture('type1', {
        foo: 'bar',
      })

      posthog.capture('type2', {
        foo: 'bar',
      })

      posthog.capture('type3', {
        foo: 'bar',
      })

      expect(posthog.getPersistedProperty(PostHogPersistedProperty.Queue)).toHaveLength(2)

      let item = posthog.getPersistedProperty<any[]>(PostHogPersistedProperty.Queue)?.pop()

      expect(item).toMatchObject({
        message: {
          library: 'posthog-core-tests',
          library_version: '2.0.0-alpha',
          type: 'capture',
          properties: {
            foo: 'bar',
          },
          event: 'type3',
        },
      })

      item = posthog.getPersistedProperty<any[]>(PostHogPersistedProperty.Queue)?.pop()

      expect(item).toMatchObject({
        message: {
          library: 'posthog-core-tests',
          library_version: '2.0.0-alpha',
          type: 'capture',
          properties: {
            foo: 'bar',
          },
          event: 'type2',
        },
      })

      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  })
})
