import { parseBody, waitForPromises } from './test-utils/test-utils'
import { createTestClient, PostHogCoreTestClient, PostHogCoreTestClientMocks } from './test-utils/PostHogCoreTestClient'
import { uuidv7 } from '../src/vendor/uuidv7'

describe('PostHog Core', () => {
  let posthog: PostHogCoreTestClient
  let mocks: PostHogCoreTestClientMocks

  jest.useFakeTimers()

  beforeEach(() => {
    ;[posthog, mocks] = createTestClient('TEST_API_KEY', { flushAt: 1 })
  })

  describe('capture', () => {
    it('should capture an event', async () => {
      jest.setSystemTime(new Date('2022-01-01'))

      posthog.capture('custom-event')

      await waitForPromises()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const [url, options] = mocks.fetch.mock.calls[0]
      expect(url).toMatch(/^https:\/\/us\.i\.posthog\.com\/batch\//)
      expect(options.method).toBe('POST')
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toEqual({
        api_key: 'TEST_API_KEY',
        batch: [
          {
            event: 'custom-event',
            distinct_id: posthog.getDistinctId(),
            library: 'posthog-core-tests',
            library_version: '2.0.0-alpha',
            properties: {
              $lib: 'posthog-core-tests',
              $lib_version: '2.0.0-alpha',
              $session_id: expect.any(String),
            },
            timestamp: '2022-01-01T00:00:00.000Z',
            uuid: expect.any(String),
            type: 'capture',
          },
        ],
        sent_at: expect.any(String),
      })
    })

    it('should allow overriding the timestamp', async () => {
      jest.setSystemTime(new Date('2022-01-01'))

      posthog.capture('custom-event', { foo: 'bar' }, { timestamp: new Date('2021-01-02') })
      await waitForPromises()
      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body).toMatchObject({
        api_key: 'TEST_API_KEY',
        batch: [
          {
            event: 'custom-event',
            timestamp: '2021-01-02T00:00:00.000Z',
          },
        ],
      })
    })

    it('should allow overriding the uuid', async () => {
      jest.setSystemTime(new Date('2022-01-01'))

      const id = uuidv7()

      posthog.capture('custom-event', { foo: 'bar' }, { uuid: id })
      await waitForPromises()
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toMatchObject({
        batch: [
          {
            event: 'custom-event',
            uuid: expect.any(String),
          },
        ],
      })
    })
  })
})
