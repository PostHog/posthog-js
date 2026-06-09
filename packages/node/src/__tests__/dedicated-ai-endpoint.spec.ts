import { PostHog, PostHogOptions } from '@/entrypoints/index.node'

const mockedFetch = jest.spyOn(globalThis, 'fetch').mockImplementation()

const HOST = 'http://example.com'
const ANALYTICS_URL = `${HOST}/batch/`
const AI_URL = `${HOST}/i/v0/ai/batch/`

const okResponse = {
  status: 200,
  text: () => Promise.resolve('ok'),
  json: () => Promise.resolve({ status: 'ok' }),
} as any

// Exact-match — AI_URL contains "/batch/" as a substring, so substring matching would conflate them.
const callsTo = (url: string): any[] => mockedFetch.mock.calls.filter((c) => c[0] === url)

const batchSentTo = (url: string): any[] | undefined => {
  const call = callsTo(url).at(-1)
  return call ? JSON.parse((call[1] as any).body).batch : undefined
}

const newClient = (options: Partial<PostHogOptions> = {}): PostHog =>
  new PostHog('TEST_API_KEY', { host: HOST, fetchRetryCount: 0, disableCompression: true, ...options })

describe('PostHog Node.js — dedicated AI endpoint (_internal_dedicatedAiEndpoint)', () => {
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockedFetch.mockResolvedValue(okResponse)
  })

  afterEach(() => {
    mockedFetch.mockReset()
    errorSpy.mockRestore()
  })

  describe('when enabled', () => {
    it('routes batched $ai_* events to the dedicated AI path', async () => {
      const ph = newClient({ _internal_dedicatedAiEndpoint: true })
      ph.capture({ distinctId: 'u1', event: '$ai_generation', properties: { $ai_model: 'gpt-4' } })
      await ph.shutdown()

      expect(batchSentTo(AI_URL)?.map((e: any) => e.event)).toEqual(['$ai_generation'])
      expect(callsTo(ANALYTICS_URL)).toHaveLength(0)
    })

    it('keeps non-AI events on the normal path, in a separate batch from AI events', async () => {
      const ph = newClient({ _internal_dedicatedAiEndpoint: true })
      ph.capture({ distinctId: 'u1', event: '$ai_generation', properties: {} })
      ph.capture({ distinctId: 'u1', event: 'button_clicked', properties: {} })
      await ph.shutdown()

      expect(batchSentTo(AI_URL)?.map((e: any) => e.event)).toEqual(['$ai_generation'])
      expect(batchSentTo(ANALYTICS_URL)?.map((e: any) => e.event)).toEqual(['button_clicked'])
    })

    it('routes immediate $ai_* captures to the dedicated AI path', async () => {
      const ph = newClient({ _internal_dedicatedAiEndpoint: true })
      await ph.captureImmediate({ distinctId: 'u1', event: '$ai_embedding', properties: {} })

      expect(batchSentTo(AI_URL)?.[0].event).toBe('$ai_embedding')
      expect(callsTo(ANALYTICS_URL)).toHaveLength(0)
      await ph.shutdown()
    })
  })

  describe('when disabled (default)', () => {
    it('routes $ai_* events to the normal batch path', async () => {
      const ph = newClient()
      ph.capture({ distinctId: 'u1', event: '$ai_generation', properties: {} })
      await ph.shutdown()

      expect(batchSentTo(ANALYTICS_URL)?.map((e: any) => e.event)).toEqual(['$ai_generation'])
      expect(callsTo(AI_URL)).toHaveLength(0)
    })
  })
})
