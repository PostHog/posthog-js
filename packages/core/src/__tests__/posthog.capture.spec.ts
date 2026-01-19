import {
  parseBody,
  waitForPromises,
  createTestClient,
  PostHogCoreTestClient,
  PostHogCoreTestClientMocks,
} from '@/testing'
import { uuidv7 } from '@/vendor/uuidv7'
import { CaptureEvent } from '@/types'

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

  describe('before_send', () => {
    it('should allow dropping events by returning null', async () => {
      const beforeSend = jest.fn().mockReturnValue(null)
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        before_send: beforeSend,
      })

      posthog.capture('custom-event', { foo: 'bar' })
      await waitForPromises()

      expect(beforeSend).toHaveBeenCalledTimes(1)
      expect(beforeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'custom-event',
          uuid: expect.any(String),
          properties: expect.objectContaining({ foo: 'bar' }),
        })
      )
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('should allow modifying events', async () => {
      const beforeSend = jest.fn((event: CaptureEvent | null) => {
        if (event) {
          return {
            ...event,
            event: 'modified-event',
            properties: { ...event.properties, added: 'property' },
          }
        }
        return event
      })
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        before_send: beforeSend,
      })

      posthog.capture('original-event', { original: 'value' })
      await waitForPromises()

      expect(beforeSend).toHaveBeenCalledTimes(1)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toMatchObject({
        batch: [
          {
            event: 'modified-event',
            properties: expect.objectContaining({
              original: 'value',
              added: 'property',
            }),
          },
        ],
      })
    })

    it('should support an array of before_send functions', async () => {
      const beforeSend1 = jest.fn((event: CaptureEvent | null) => {
        if (event) {
          return { ...event, properties: { ...event.properties, from_first: true } }
        }
        return event
      })
      const beforeSend2 = jest.fn((event: CaptureEvent | null) => {
        if (event) {
          return { ...event, properties: { ...event.properties, from_second: true } }
        }
        return event
      })
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        before_send: [beforeSend1, beforeSend2],
      })

      posthog.capture('custom-event')
      await waitForPromises()

      expect(beforeSend1).toHaveBeenCalledTimes(1)
      expect(beforeSend2).toHaveBeenCalledTimes(1)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toMatchObject({
        batch: [
          {
            event: 'custom-event',
            properties: expect.objectContaining({
              from_first: true,
              from_second: true,
            }),
          },
        ],
      })
    })

    it('should stop processing if any function in the array returns null', async () => {
      const beforeSend1 = jest.fn((event: CaptureEvent | null) => {
        if (event) {
          return { ...event, properties: { ...event.properties, from_first: true } }
        }
        return event
      })
      const beforeSend2 = jest.fn().mockReturnValue(null)
      const beforeSend3 = jest.fn((event: CaptureEvent | null) => event)
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        before_send: [beforeSend1, beforeSend2, beforeSend3],
      })

      posthog.capture('custom-event')
      await waitForPromises()

      expect(beforeSend1).toHaveBeenCalledTimes(1)
      expect(beforeSend2).toHaveBeenCalledTimes(1)
      expect(beforeSend3).not.toHaveBeenCalled() // Should not be called because beforeSend2 returned null
      expect(mocks.fetch).not.toHaveBeenCalled()
    })

    it('should pass timestamp and uuid through before_send', async () => {
      const customDate = new Date('2023-06-15')
      const customUuid = uuidv7()
      const beforeSend = jest.fn((event: CaptureEvent | null) => event)
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        before_send: beforeSend,
      })

      posthog.capture('custom-event', {}, { timestamp: customDate, uuid: customUuid })
      await waitForPromises()

      // timestamp is a Date object when provided via options
      expect(beforeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'custom-event',
          timestamp: customDate,
          uuid: customUuid,
        })
      )
    })

    it('should allow modifying timestamp and uuid in before_send', async () => {
      const modifiedDate = new Date('2020-01-01T00:00:00.000Z')
      const modifiedUuid = 'modified-uuid-123'
      const beforeSend = jest.fn((event: CaptureEvent | null) => {
        if (event) {
          return {
            ...event,
            timestamp: modifiedDate,
            uuid: modifiedUuid,
          }
        }
        return event
      })
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        before_send: beforeSend,
      })

      posthog.capture('custom-event')
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body).toMatchObject({
        batch: [
          {
            event: 'custom-event',
            timestamp: '2020-01-01T00:00:00.000Z',
            uuid: modifiedUuid,
          },
        ],
      })
    })

    it('should include $geoip_disable in before_send when disableGeoip is true', async () => {
      const beforeSend = jest.fn((event: CaptureEvent | null) => event)
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        disableGeoip: true,
        before_send: beforeSend,
      })

      posthog.capture('custom-event')
      await waitForPromises()

      expect(beforeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            $geoip_disable: true,
          }),
        })
      )
    })

    it('should allow removing $geoip_disable in before_send', async () => {
      const beforeSend = jest.fn((event: CaptureEvent | null) => {
        if (event && event.properties) {
          const { $geoip_disable, ...rest } = event.properties
          return { ...event, properties: rest }
        }
        return event
      })
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        disableGeoip: true,
        before_send: beforeSend,
      })

      posthog.capture('custom-event')
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      // $geoip_disable should not be in the final properties
      expect(body.batch[0].properties.$geoip_disable).toBeUndefined()
    })

    it('should allow adding $geoip_disable in before_send when disableGeoip is false', async () => {
      const beforeSend = jest.fn((event: CaptureEvent | null) => {
        if (event) {
          return {
            ...event,
            properties: { ...event.properties, $geoip_disable: true },
          }
        }
        return event
      })
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        disableGeoip: false,
        before_send: beforeSend,
      })

      posthog.capture('custom-event')
      await waitForPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])

      expect(body.batch[0].properties.$geoip_disable).toBe(true)
    })

    it('should include $geoip_disable in before_send when passed via capture options', async () => {
      const beforeSend = jest.fn((event: CaptureEvent | null) => event)
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        disableGeoip: false, // Default is false
        before_send: beforeSend,
      })

      // Pass disableGeoip: true via capture options
      posthog.capture('custom-event', {}, { disableGeoip: true })
      await waitForPromises()

      expect(beforeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            $geoip_disable: true,
          }),
        })
      )

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      const body = parseBody(mocks.fetch.mock.calls[0])
      expect(body.batch[0].properties.$geoip_disable).toBe(true)
    })

    it('should allow capture options disableGeoip to override default setting', async () => {
      const beforeSend = jest.fn((event: CaptureEvent | null) => event)
      ;[posthog, mocks] = createTestClient('TEST_API_KEY', {
        flushAt: 1,
        disableGeoip: true, // Default is true
        before_send: beforeSend,
      })

      // First capture with default (should have $geoip_disable: true)
      posthog.capture('event-with-default')
      await waitForPromises()

      expect(beforeSend).toHaveBeenLastCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            $geoip_disable: true,
          }),
        })
      )

      // Second capture with explicit disableGeoip: false
      // Note: This tests that per-call options override the default
      // However, since disableGeoip: false means "don't disable", $geoip_disable should not be set
      beforeSend.mockClear()
      posthog.capture('event-with-override', {}, { disableGeoip: false })
      await waitForPromises()

      // $geoip_disable should NOT be in the properties when disableGeoip is false
      const lastCall = beforeSend.mock.calls[0][0]
      expect(lastCall.properties.$geoip_disable).toBeUndefined()
    })
  })
})
