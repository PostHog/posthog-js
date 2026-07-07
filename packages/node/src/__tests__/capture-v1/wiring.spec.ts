import { PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { CaptureV1Error } from '@/capture-v1/errors'
import { waitForPromises } from '../utils'

jest.mock('../../version', () => ({ version: '1.2.3' }))

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const V1_URL = 'http://example.com/i/v1/analytics/events'

function v1Response(results: Record<string, unknown> = {}): any {
  const body = JSON.stringify({ results })
  return {
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve({ results }),
    headers: { get: () => null },
    body: null,
  }
}

function v0Response(): any {
  return {
    status: 200,
    text: () => Promise.resolve('ok'),
    json: () => Promise.resolve({ status: 'ok' }),
    headers: { get: () => null },
    body: null,
  }
}

function callsTo(fragment: string): [string, any][] {
  return mockedFetch.mock.calls.filter((call) => (call[0] as string).includes(fragment)) as [string, any][]
}

function eventsIn(fragment: string): string[] {
  return callsTo(fragment).flatMap((call) => JSON.parse(call[1].body).batch.map((event: any) => event.event))
}

describe('capture v1 wiring (Node SDK)', () => {
  const clients: PostHog[] = []

  jest.useFakeTimers()

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    mockedFetch.mockImplementation((url) =>
      Promise.resolve((url as string).includes('/i/v1/analytics/events') ? v1Response() : v0Response())
    )
  })

  afterEach(async () => {
    while (clients.length) {
      await clients.pop()?.shutdown()
    }
    jest.clearAllMocks()
  })

  function makeClient(options: PostHogOptions = {}): PostHog {
    const client = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      disableCompression: true,
      ...options,
    })
    clients.push(client)
    return client
  }

  const waitForFlushTimer = async (): Promise<void> => {
    await waitForPromises()
    jest.runOnlyPendingTimers()
    await waitForPromises()
  }

  describe('v0 mode (default)', () => {
    it('sends every event to /batch/ and never touches the v1 endpoint', async () => {
      const posthog = makeClient()
      posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
      posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt' } })
      await waitForFlushTimer()

      expect(callsTo('/i/v1/analytics/events')).toHaveLength(0)
      const events = eventsIn('/batch/')
      expect(events).toContain('custom')
      expect(events).toContain('$ai_generation')
    })
  })

  describe('v1 mode - batched path', () => {
    it('sends a normal event to the v1 endpoint with Bearer auth and the v1 envelope', async () => {
      const posthog = makeClient({ captureMode: 'v1' })
      posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
      await waitForFlushTimer()

      expect(callsTo('/batch/')).toHaveLength(0)
      const calls = callsTo('/i/v1/analytics/events')
      expect(calls).toHaveLength(1)
      const [url, options] = calls[0]
      expect(url).toBe(V1_URL)
      expect(options.headers['Authorization']).toBe('Bearer TEST_API_KEY')
      expect(options.headers['PostHog-Sdk-Info']).toBe('posthog-node/1.2.3')
      const body = JSON.parse(options.body)
      expect(body).not.toHaveProperty('api_key')
      expect(body.batch[0].event).toBe('custom')
      expect(body.batch[0].options).toEqual({})
    })

    it('routes $ai_* events to the legacy /batch/ endpoint', async () => {
      const posthog = makeClient({ captureMode: 'v1' })
      posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt' } })
      await waitForFlushTimer()

      expect(callsTo('/i/v1/analytics/events')).toHaveLength(0)
      expect(eventsIn('/batch/')).toContain('$ai_generation')
    })

    it('splits a mixed batch across both endpoints with no loss or duplication', async () => {
      const posthog = makeClient({ captureMode: 'v1' })
      posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
      posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt' } })
      await waitForFlushTimer()

      expect(eventsIn('/i/v1/analytics/events')).toEqual(['custom'])
      expect(eventsIn('/batch/')).toEqual(['$ai_generation'])
    })
  })

  describe('v1 mode - immediate path', () => {
    it('sends an immediate non-AI event to the v1 endpoint', async () => {
      const posthog = makeClient({ captureMode: 'v1' })
      await posthog.captureImmediate({ distinctId: 'u', event: 'custom', properties: { x: 1 } })

      expect(callsTo('/batch/')).toHaveLength(0)
      expect(eventsIn('/i/v1/analytics/events')).toEqual(['custom'])
    })

    it('sends an immediate $ai_* event to the legacy endpoint', async () => {
      const posthog = makeClient({ captureMode: 'v1' })
      await posthog.captureImmediate({ distinctId: 'u', event: '$ai_span', properties: { $ai_model: 'gpt' } })

      expect(callsTo('/i/v1/analytics/events')).toHaveLength(0)
      expect(eventsIn('/batch/')).toContain('$ai_span')
    })
  })

  describe('v1 mode - before_send interaction', () => {
    it('routes an event renamed into $ai_* by before_send to the legacy endpoint', async () => {
      const posthog = makeClient({
        captureMode: 'v1',
        before_send: (event) => (event ? { ...event, event: '$ai_generation' } : event),
      })
      posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
      await waitForFlushTimer()

      expect(callsTo('/i/v1/analytics/events')).toHaveLength(0)
      expect(eventsIn('/batch/')).toContain('$ai_generation')
    })

    it('routes an event renamed out of $ai_* by before_send to the v1 endpoint', async () => {
      const posthog = makeClient({
        captureMode: 'v1',
        before_send: (event) => (event ? { ...event, event: 'renamed' } : event),
      })
      posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt' } })
      await waitForFlushTimer()

      expect(callsTo('/batch/')).toHaveLength(0)
      expect(eventsIn('/i/v1/analytics/events')).toContain('renamed')
    })
  })

  describe('v1 mode - error surfacing', () => {
    it('emits a CaptureV1Error on the error channel when the server drops an event', async () => {
      mockedFetch.mockImplementation((url, options) => {
        if ((url as string).includes('/i/v1/analytics/events')) {
          const body = JSON.parse((options as any).body)
          const results: Record<string, unknown> = {}
          for (const event of body.batch) {
            results[event.uuid] = { result: 'drop', details: 'billing' }
          }
          return Promise.resolve(v1Response(results))
        }
        return Promise.resolve(v0Response())
      })

      const posthog = makeClient({ captureMode: 'v1' })
      const errors: Error[] = []
      posthog.on('error', (error) => errors.push(error))

      posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
      await waitForFlushTimer()

      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureV1Error
      expect(error).toBeInstanceOf(CaptureV1Error)
      expect(error.drops[0].details).toBe('billing')
    })
  })
})
