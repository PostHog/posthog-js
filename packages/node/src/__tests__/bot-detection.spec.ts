import { PostHog } from '@/entrypoints/index.node'
import { waitForPromises } from './utils'

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

jest.useFakeTimers()

// Helper to wait for flush to complete
const waitForFlushTimer = async (): Promise<void> => {
  await waitForPromises()
  // To trigger the flush via the timer
  jest.runOnlyPendingTimers()
  // Then wait for the flush promise
  await waitForPromises()
}

describe('bot detection and pageview collection (Node SDK)', () => {
  let client: PostHog

  beforeEach(() => {
    mockedFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
      json: () => Promise.resolve({ status: 1 }),
    } as any)
  })

  afterEach(async () => {
    if (client) {
      await client.shutdown()
    }
    mockedFetch.mockClear()
  })

  describe('default behavior (without preview flag)', () => {
    it('should allow events with bot user agents by default', async () => {
      client = new PostHog('test-api-key', {
        host: 'http://example.com',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        disableCompression: true,
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalled()
      const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as any).body)
      expect(body.batch[0].event).toBe('$pageview')
    })

    it('should allow events without user agent', async () => {
      client = new PostHog('test-api-key', {
        host: 'http://example.com',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        disableCompression: true,
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {},
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalled()
      const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as any).body)
      expect(body.batch[0].event).toBe('$pageview')
    })
  })

  describe('with __preview_send_bot_pageviews enabled', () => {
    it('should rename bot pageviews to $bot_pageview', async () => {
      client = new PostHog('test-api-key', {
        host: 'http://example.com',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        disableCompression: true,
        __preview_send_bot_pageviews: true,
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalled()
      const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as any).body)
      expect(body.batch[0].event).toBe('$bot_pageview')
      expect(body.batch[0].properties.$raw_user_agent).toBe(
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
      )
    })

    it('should keep normal browser pageviews as $pageview', async () => {
      client = new PostHog('test-api-key', {
        host: 'http://example.com',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        disableCompression: true,
        __preview_send_bot_pageviews: true,
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalled()
      const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as any).body)
      expect(body.batch[0].event).toBe('$pageview')
      expect(body.batch[0].properties.$raw_user_agent).toBe(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      )
    })

    it('should not rename non-pageview bot events', async () => {
      client = new PostHog('test-api-key', {
        host: 'http://example.com',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        disableCompression: true,
        __preview_send_bot_pageviews: true,
      })

      client.capture({
        distinctId: 'user_123',
        event: 'custom_event',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        },
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalled()
      const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as any).body)
      expect(body.batch[0].event).toBe('custom_event')
    })

    it('should work with various bot user agents', async () => {
      const botUserAgents = [
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'facebookexternalagent',
        'Twitterbot/1.0',
        'LinkedInBot/1.0',
        'Chrome-Lighthouse',
        'HeadlessChrome/91.0.4472.124',
      ]

      for (const ua of botUserAgents) {
        mockedFetch.mockClear()
        client = new PostHog('test-api-key', {
          host: 'http://example.com',
          flushAt: 1,
          flushInterval: 0,
          fetchRetryCount: 0,
          disableCompression: true,
          __preview_send_bot_pageviews: true,
        })

        client.capture({
          distinctId: 'user_123',
          event: '$pageview',
          properties: {
            $raw_user_agent: ua,
          },
        })

        await waitForFlushTimer()

        expect(mockedFetch).toHaveBeenCalled()
        const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
        expect(call).toBeDefined()
        const body = JSON.parse((call![1] as any).body)
        expect(body.batch[0].event).toBe('$bot_pageview')
        expect(body.batch[0].properties.$raw_user_agent).toBe(ua)

        await client.shutdown()
      }
    })

    it('should handle events without user agent gracefully', async () => {
      client = new PostHog('test-api-key', {
        host: 'http://example.com',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        disableCompression: true,
        __preview_send_bot_pageviews: true,
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {},
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalled()
      const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as any).body)
      expect(body.batch[0].event).toBe('$pageview')
    })

    it('should support custom_blocked_useragents', async () => {
      client = new PostHog('test-api-key', {
        host: 'http://example.com',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        disableCompression: true,
        __preview_send_bot_pageviews: true,
        custom_blocked_useragents: ['MyCustomBot'],
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'MyCustomBot/1.0',
        },
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalled()
      const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as any).body)
      expect(body.batch[0].event).toBe('$bot_pageview')
      expect(body.batch[0].properties.$raw_user_agent).toBe('MyCustomBot/1.0')
    })

    it('should preserve other event properties when renaming', async () => {
      client = new PostHog('test-api-key', {
        host: 'http://example.com',
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        disableCompression: true,
        __preview_send_bot_pageviews: true,
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          custom_prop: 'test_value',
          $current_url: 'https://example.com',
        },
      })

      await waitForFlushTimer()

      expect(mockedFetch).toHaveBeenCalled()
      const call = mockedFetch.mock.calls.find((x) => (x[0] as string).includes('/batch/'))
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as any).body)
      expect(body.batch[0].event).toBe('$bot_pageview')
      expect(body.batch[0].properties.custom_prop).toBe('test_value')
      expect(body.batch[0].properties.$current_url).toBe('https://example.com')
    })
  })
})
