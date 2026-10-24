import { gunzipSync } from 'node:zlib'

import { CaptureError, PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { ANALYTICS_CAPTURE_URL, AI_CAPTURE_PATH, ANALYTICS_CAPTURE_PATH, v1Response } from '../utils'
import { V1WiringHarness, okResponse, waitForFlushTimer } from '../utils/v1-wiring'

vi.mock('../../version', () => ({ version: '1.2.3' }))

describe('capture v1 wiring (Node SDK)', () => {
  vi.useFakeTimers()

  const harness = new V1WiringHarness()
  const mockedFetch = harness.fetch
  const makeClient = (options?: PostHogOptions): PostHog => harness.makeClient(options)
  const callsTo = (fragment: string): [string, any][] => harness.callsTo(fragment)
  const eventsIn = (fragment: string): string[] => harness.eventsIn(fragment)

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.clearAllMocks()
  })

  describe('POSTHOG_CAPTURE_MODE', () => {
    const original = process.env.POSTHOG_CAPTURE_MODE

    afterEach(() => {
      if (original === undefined) {
        delete process.env.POSTHOG_CAPTURE_MODE
      } else {
        process.env.POSTHOG_CAPTURE_MODE = original
      }
    })

    it('warns once per client that the variable is ignored, and still sends to capture v1', async () => {
      process.env.POSTHOG_CAPTURE_MODE = 'v0'
      const posthog = makeClient()
      posthog.capture({ distinctId: 'u', event: 'first', properties: {} })
      posthog.capture({ distinctId: 'u', event: 'second', properties: {} })
      await posthog.flush()

      const warnings = (console.warn as vi.Mock).mock.calls.filter((call) =>
        String(call[0]).includes('POSTHOG_CAPTURE_MODE')
      )
      expect(warnings).toEqual([['[PostHog] POSTHOG_CAPTURE_MODE is no longer read. Capture always uses capture v1.']])
      expect(callsTo('/batch/')).toHaveLength(0)
      expect(eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['first', 'second'])
    })

    it('does not warn when the variable is unset', () => {
      delete process.env.POSTHOG_CAPTURE_MODE
      makeClient()

      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('POSTHOG_CAPTURE_MODE'))
    })
  })

  describe('Node gzip compression', () => {
    let originalCompressionStream: PropertyDescriptor | undefined
    let compressionStreamSpy: vi.Mock

    const readCompressedBody = async (body: Blob | Uint8Array): Promise<any> => {
      const bytes = body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(await body.arrayBuffer())
      return JSON.parse(gunzipSync(bytes).toString())
    }

    beforeEach(() => {
      originalCompressionStream = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream')
      compressionStreamSpy = vi.fn(() => {
        throw new Error('The Node SDK should not use CompressionStream')
      })
      Object.defineProperty(globalThis, 'CompressionStream', {
        configurable: true,
        writable: true,
        value: compressionStreamSpy,
      })
    })

    afterEach(() => {
      if (originalCompressionStream) {
        Object.defineProperty(globalThis, 'CompressionStream', originalCompressionStream)
      } else {
        delete (globalThis as any).CompressionStream
      }
    })

    it.each([
      ['capture()', ANALYTICS_CAPTURE_PATH],
      ['captureAi()', AI_CAPTURE_PATH],
    ] as const)('uses Node gzip for %s on %s', async (method, path) => {
      const posthog = makeClient({ disableCompression: false, captureAiCompression: undefined })
      const event = { distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt-4o-mini' } }
      if (method === 'capture()') {
        posthog.capture(event)
      } else {
        posthog.captureAi(event)
      }
      await posthog.flush()

      const [, options] = callsTo(path)[0]
      expect(options.headers['Content-Encoding']).toBe('gzip')
      expect(options.body).toBeInstanceOf(Uint8Array)
      expect((await readCompressedBody(options.body)).batch[0].event).toBe('$ai_generation')
      expect(compressionStreamSpy).not.toHaveBeenCalled()
    })

    it.each([
      ['logs', '/i/v1/logs', 'resourceLogs'],
      ['metrics', '/i/v1/metrics', 'resourceMetrics'],
    ] as const)('uses Node gzip for the %s endpoint', async (kind, path, payloadKey) => {
      const posthog = makeClient({ disableCompression: false })
      const outcome =
        kind === 'logs'
          ? await posthog._sendLogsBatch({ resourceLogs: [] })
          : await posthog._sendMetricsBatch({ resourceMetrics: [] })

      expect(outcome).toEqual({ kind: 'ok' })
      const [, options] = callsTo(path)[0]
      expect(options.headers['Content-Encoding']).toBe('gzip')
      expect(options.body).toBeInstanceOf(Uint8Array)
      expect((await readCompressedBody(options.body))[payloadKey]).toEqual([])
      expect(compressionStreamSpy).not.toHaveBeenCalled()
    })
  })

  describe('batched path', () => {
    it('sends a normal event to the v1 endpoint with Bearer auth and the v1 envelope', async () => {
      const posthog = makeClient()
      posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
      await waitForFlushTimer()

      expect(callsTo('/batch/')).toHaveLength(0)
      const calls = callsTo(ANALYTICS_CAPTURE_PATH)
      expect(calls).toHaveLength(1)
      const [url, options] = calls[0]
      expect(url).toBe(ANALYTICS_CAPTURE_URL)
      expect(options.headers['Authorization']).toBe('Bearer TEST_API_KEY')
      expect(options.headers['PostHog-Sdk-Info']).toBe('posthog-node/1.2.3')
      const body = JSON.parse(options.body)
      expect(body).not.toHaveProperty('api_key')
      expect(body.batch[0].event).toBe('custom')
      expect(body.batch[0].options).toEqual({})
    })

    it('keeps $ai_* capture() events on the analytics endpoint, in the same request as other events', async () => {
      const posthog = makeClient()
      posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
      posthog.capture({ distinctId: 'u', event: '$ai_generation', properties: { $ai_model: 'gpt' } })
      await waitForFlushTimer()

      expect(callsTo(ANALYTICS_CAPTURE_PATH)).toHaveLength(1)
      expect(eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['custom', '$ai_generation'])
      expect(callsTo(AI_CAPTURE_PATH)).toHaveLength(0)
      expect(callsTo('/batch/')).toHaveLength(0)
    })
  })

  describe('immediate path', () => {
    it('sends an immediate non-AI event to the v1 endpoint', async () => {
      const posthog = makeClient()
      await posthog.captureImmediate({ distinctId: 'u', event: 'custom', properties: { x: 1 } })

      expect(callsTo('/batch/')).toHaveLength(0)
      expect(eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['custom'])
    })

    it('sends an immediate $ai_* event to the analytics endpoint', async () => {
      const posthog = makeClient()
      await posthog.captureImmediate({ distinctId: 'u', event: '$ai_span', properties: { $ai_model: 'gpt' } })

      expect(eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['$ai_span'])
      expect(callsTo(AI_CAPTURE_PATH)).toHaveLength(0)
      expect(callsTo('/batch/')).toHaveLength(0)
    })

    it('sends immediate identify/alias/groupIdentify (special non-AI events) to the v1 endpoint', async () => {
      const posthog = makeClient()

      await posthog.identifyImmediate({ distinctId: 'u', properties: { name: 'a' } })
      await posthog.aliasImmediate({ distinctId: 'u', alias: 'anon-1' })
      await posthog.groupIdentifyImmediate({ groupType: 'company', groupKey: 'acme', properties: { plan: 'pro' } })

      expect(callsTo('/batch/')).toHaveLength(0)
      expect(eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual(['$identify', '$create_alias', '$groupidentify'])
    })
  })

  describe('before_send interaction', () => {
    it.each([
      ['into', 'custom', '$ai_generation'],
      ['out of', '$ai_generation', 'renamed'],
    ])('keeps an event renamed %s $ai_* by before_send on the analytics endpoint', async (_, original, renamed) => {
      const posthog = makeClient({
        before_send: (event) => (event ? { ...event, event: renamed } : event),
      })
      posthog.capture({ distinctId: 'u', event: original, properties: { x: 1 } })
      await waitForFlushTimer()

      expect(eventsIn(ANALYTICS_CAPTURE_PATH)).toEqual([renamed])
      expect(callsTo(AI_CAPTURE_PATH)).toHaveLength(0)
    })
  })

  describe('error surfacing', () => {
    it('emits an exported CaptureError naming the analytics lane when the server drops an event', async () => {
      mockedFetch.mockImplementation((url, options) => {
        if ((url as string).includes(ANALYTICS_CAPTURE_PATH)) {
          const body = JSON.parse((options as any).body)
          const results: Record<string, unknown> = {}
          for (const event of body.batch) {
            results[event.uuid] = { result: 'drop', details: 'billing' }
          }
          return Promise.resolve(v1Response(results))
        }
        return Promise.resolve(okResponse())
      })

      const posthog = makeClient()
      const errors: Error[] = []
      posthog.on('error', (error) => errors.push(error))

      posthog.capture({ distinctId: 'u', event: 'custom', properties: { x: 1 } })
      await waitForFlushTimer()

      expect(errors).toHaveLength(1)
      const error = errors[0] as CaptureError
      expect(error).toBeInstanceOf(CaptureError)
      expect(error.endpoint).toBe(ANALYTICS_CAPTURE_PATH)
      expect(error.drops[0].details).toBe('billing')
    })
  })
})
