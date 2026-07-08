import { PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { CaptureV1Error } from '@/capture-v1/errors'
import { V1_URL, V1WiringHarness, v0Response, v1Response, waitForFlushTimer } from '../utils/v1-wiring'

jest.mock('../../version', () => ({ version: '1.2.3' }))

describe('capture v1 wiring (Node SDK)', () => {
  jest.useFakeTimers()

  const harness = new V1WiringHarness()
  const mockedFetch = harness.fetch
  const makeClient = (options?: PostHogOptions): PostHog => harness.makeClient(options)
  const callsTo = (fragment: string): [string, any][] => harness.callsTo(fragment)
  const eventsIn = (fragment: string): string[] => harness.eventsIn(fragment)

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    jest.clearAllMocks()
  })

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

    it('sends immediate identify/alias/groupIdentify (special non-AI events) to the v1 endpoint', async () => {
      const posthog = makeClient({ captureMode: 'v1' })

      await posthog.identifyImmediate({ distinctId: 'u', properties: { name: 'a' } })
      await posthog.aliasImmediate({ distinctId: 'u', alias: 'anon-1' })
      await posthog.groupIdentifyImmediate({ groupType: 'company', groupKey: 'acme', properties: { plan: 'pro' } })

      expect(callsTo('/batch/')).toHaveLength(0)
      expect(eventsIn('/i/v1/analytics/events')).toEqual(['$identify', '$create_alias', '$groupidentify'])
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
