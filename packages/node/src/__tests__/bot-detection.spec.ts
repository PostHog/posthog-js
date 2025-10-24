import { PostHog } from '@/entrypoints/index.node'
import { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

describe('bot detection and pageview collection (Node SDK)', () => {
  let client: PostHog

  afterEach(async () => {
    if (client) {
      await client.shutdown()
    }
    mockedFetch.mockClear()
  })

  describe('default behavior (without preview flag)', () => {
    it('should allow events with bot user agents by default', (done) => {
      client = new PostHog('test-api-key', {
        flushAt: 1,
        flushInterval: 0,
        fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
          const body = JSON.parse(options.body as string)
          expect(body.batch[0].event).toBe('$pageview')
          done()
          return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
        },
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })
    })

    it('should allow events without user agent', (done) => {
      client = new PostHog('test-api-key', {
        flushAt: 1,
        flushInterval: 0,
        fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
          const body = JSON.parse(options.body as string)
          expect(body.batch[0].event).toBe('$pageview')
          done()
          return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
        },
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {},
      })
    })
  })

  describe('with __preview_send_bot_pageviews enabled', () => {
    it('should rename bot pageviews to $bot_pageview', (done) => {
      client = new PostHog('test-api-key', {
        flushAt: 1,
        flushInterval: 0,
        __preview_send_bot_pageviews: true,
        fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
          const body = JSON.parse(options.body as string)
          expect(body.batch[0].event).toBe('$bot_pageview')
          expect(body.batch[0].properties.$raw_user_agent).toBe(
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
          )
          done()
          return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
        },
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })
    })

    it('should keep normal browser pageviews as $pageview', (done) => {
      client = new PostHog('test-api-key', {
        flushAt: 1,
        flushInterval: 0,
        __preview_send_bot_pageviews: true,
        fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
          const body = JSON.parse(options.body as string)
          expect(body.batch[0].event).toBe('$pageview')
          expect(body.batch[0].properties.$raw_user_agent).toBe(
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          )
          done()
          return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
        },
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      })
    })

    it('should not rename non-pageview bot events', (done) => {
      client = new PostHog('test-api-key', {
        flushAt: 1,
        flushInterval: 0,
        __preview_send_bot_pageviews: true,
        fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
          const body = JSON.parse(options.body as string)
          expect(body.batch[0].event).toBe('custom_event')
          done()
          return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
        },
      })

      client.capture({
        distinctId: 'user_123',
        event: 'custom_event',
        properties: {
          $raw_user_agent: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        },
      })
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
        await new Promise<void>((resolve) => {
          client = new PostHog('test-api-key', {
            flushAt: 1,
            flushInterval: 0,
            __preview_send_bot_pageviews: true,
            fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
              const body = JSON.parse(options.body as string)
              expect(body.batch[0].event).toBe('$bot_pageview')
              expect(body.batch[0].properties.$raw_user_agent).toBe(ua)
              resolve()
              return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
            },
          })

          client.capture({
            distinctId: 'user_123',
            event: '$pageview',
            properties: {
              $raw_user_agent: ua,
            },
          })
        })

        await client.shutdown()
      }
    })

    it('should handle events without user agent gracefully', (done) => {
      client = new PostHog('test-api-key', {
        flushAt: 1,
        flushInterval: 0,
        __preview_send_bot_pageviews: true,
        fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
          const body = JSON.parse(options.body as string)
          expect(body.batch[0].event).toBe('$pageview')
          done()
          return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
        },
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {},
      })
    })

    it('should support custom_blocked_useragents', (done) => {
      client = new PostHog('test-api-key', {
        flushAt: 1,
        flushInterval: 0,
        __preview_send_bot_pageviews: true,
        custom_blocked_useragents: ['MyCustomBot'],
        fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
          const body = JSON.parse(options.body as string)
          expect(body.batch[0].event).toBe('$bot_pageview')
          expect(body.batch[0].properties.$raw_user_agent).toBe('MyCustomBot/1.0')
          done()
          return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
        },
      })

      client.capture({
        distinctId: 'user_123',
        event: '$pageview',
        properties: {
          $raw_user_agent: 'MyCustomBot/1.0',
        },
      })
    })

    it('should preserve other event properties when renaming', (done) => {
      client = new PostHog('test-api-key', {
        flushAt: 1,
        flushInterval: 0,
        __preview_send_bot_pageviews: true,
        fetch: async (_url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
          const body = JSON.parse(options.body as string)
          expect(body.batch[0].event).toBe('$bot_pageview')
          expect(body.batch[0].properties.custom_prop).toBe('test_value')
          expect(body.batch[0].properties.$current_url).toBe('https://example.com')
          done()
          return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) } as any
        },
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
    })
  })
})
