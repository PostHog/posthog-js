import { gunzipSync, gzipSync } from 'zlib'
import { PostHog, PostHogOptions } from '../src'
import { base64ToBytes } from '../src/compression'

const { pluginGzip } = vi.hoisted(() => ({ pluginGzip: vi.fn<(payload: string) => Promise<string | null>>() }))

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: undefined,
  OptionalReactNativePlugin: {
    setup: vi.fn(async () => {}),
    startSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => false),
    gzip: pluginGzip,
  },
}))

const AI_PATH = '/i/v1/ai/events'
const ANALYTICS_PATH = '/i/v1/analytics/events'

describe('React Native capture compression without CompressionStream', () => {
  const originalFetch = (globalThis as any).window.fetch
  const originalCompressionStream = (globalThis as any).CompressionStream
  let requests: { path: string; headers: Record<string, string>; body: string | Uint8Array }[]
  let posthog: PostHog | undefined

  beforeAll(() => {
    vi.useRealTimers()
    delete (globalThis as any).CompressionStream
  })

  afterAll(() => {
    ;(globalThis as any).CompressionStream = originalCompressionStream
    ;(globalThis as any).window.fetch = originalFetch
    vi.useFakeTimers()
  })

  beforeEach(() => {
    requests = []
    pluginGzip.mockReset()
    pluginGzip.mockImplementation(async (payload) => gzipSync(payload).toString('base64'))
    ;(globalThis as any).window.fetch = vi.fn(async (url: string, options: any) => {
      const path = new URL(String(url)).pathname
      if (path === AI_PATH || path === ANALYTICS_PATH) {
        requests.push({ path, headers: options.headers, body: options.body })
      }
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({ results: {} }),
        text: async () => '{"results":{}}',
      }
    })
  })

  afterEach(async () => {
    await posthog?.shutdown()
    posthog = undefined
  })

  const newPostHog = async (options: PostHogOptions = {}): Promise<PostHog> => {
    posthog = new PostHog('test-token', {
      flushInterval: 0,
      flushAt: 10,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      persistence: 'memory',
      ...options,
    })
    await posthog.ready()
    return posthog
  }

  const decoded = (body: string | Uint8Array): any =>
    JSON.parse(typeof body === 'string' ? body : gunzipSync(body).toString('utf8'))

  it('gzips analytics and AI requests with the plugin', async () => {
    const client = await newPostHog()

    client.capture('signed_up')
    client.captureAi('$ai_generation', { $ai_model: 'gpt-4o' })
    await client.flush()

    expect(requests.map((r) => [r.path, r.headers['Content-Encoding'], r.body instanceof Uint8Array])).toEqual(
      expect.arrayContaining([
        [ANALYTICS_PATH, 'gzip', true],
        [AI_PATH, 'gzip', true],
      ])
    )
    expect(requests).toHaveLength(2)
    const events = requests.flatMap((r) => decoded(r.body).batch.map((event: any) => event.event))
    expect(events.sort()).toEqual(['$ai_generation', 'signed_up'])
  })

  it('sends uncompressed when the plugin cannot gzip', async () => {
    pluginGzip.mockResolvedValue(null)
    const client = await newPostHog()

    client.captureAi('$ai_generation')
    await client.flush()

    expect(requests).toHaveLength(1)
    expect(requests[0].headers['Content-Encoding']).toBeUndefined()
    expect(decoded(requests[0].body).batch[0].event).toBe('$ai_generation')
  })

  it.each([
    ['disableCompression', { disableCompression: true }, ANALYTICS_PATH, 'signed_up'],
    ["captureAiCompression 'none'", { captureAiCompression: 'none' as const }, AI_PATH, '$ai_generation'],
  ])('leaves bodies uncompressed with %s', async (_name, options, path, event) => {
    const client = await newPostHog(options)

    if (path === AI_PATH) {
      client.captureAi(event)
    } else {
      client.capture(event)
    }
    await client.flush()

    const request = requests.find((r) => r.path === path)!
    expect(typeof request.body).toBe('string')
    expect(request.headers['Content-Encoding']).toBeUndefined()
  })

  it('decodes base64 of every length', () => {
    for (let length = 0; length < 64; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 255)
      expect(Array.from(base64ToBytes(Buffer.from(bytes).toString('base64')))).toEqual(Array.from(bytes))
    }
  })
})
