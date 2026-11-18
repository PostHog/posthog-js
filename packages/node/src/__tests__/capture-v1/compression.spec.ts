import * as zlib from 'node:zlib'

import {
  type CaptureCodec,
  type CaptureCompression,
  type CaptureCompressor,
  resolveCaptureCodec,
  webCompressor,
} from '@/capture-v1/compression'
import { createZlibCompressor } from '@/compression.node'
import { PostHog as EdgePostHog } from '@/entrypoints/index.edge'
import { PostHog, type PostHogOptions } from '@/entrypoints/index.node'

import { AI_CAPTURE_PATH, ANALYTICS_CAPTURE_PATH } from '../utils'
import { V1WiringHarness } from '../utils/v1-wiring'

vi.mock('../../version', () => ({ version: '1.2.3' }))

const zstdDecompressSync = (zlib as { zstdDecompressSync?: (input: Uint8Array) => Buffer }).zstdDecompressSync
const hasZstd = typeof (zlib as { zstdCompress?: unknown }).zstdCompress === 'function'

/** Decodes a request body the way the server would for its `Content-Encoding`. */
function decode(encoding: string | undefined, body: string | Uint8Array): any {
  if (encoding === undefined) {
    return JSON.parse(body as string)
  }
  const bytes = body as Uint8Array
  const decoders: Record<string, (input: Uint8Array) => Buffer> = {
    gzip: zlib.gunzipSync,
    // inflateSync rejects a raw deflate stream, so this also proves the body is zlib-wrapped.
    deflate: zlib.inflateSync,
    zstd: (input) => zstdDecompressSync!(input),
  }
  return JSON.parse(decoders[encoding](bytes).toString())
}

const fakeCompressor = (supported: CaptureCodec[]): CaptureCompressor => ({
  supports: (codec) => supported.includes(codec),
  compress: () => Promise.resolve(null),
})

describe('capture compression', () => {
  describe('createZlibCompressor', () => {
    it.each<CaptureCodec>(['gzip', 'deflate', ...(hasZstd ? (['zstd'] as const) : [])])(
      'compresses with %s',
      async (codec) => {
        const compressor = createZlibCompressor()

        const compressed = await compressor.compress('{"batch":[]}', codec)

        expect(compressor.supports(codec)).toBe(true)
        expect(decode(codec, compressed!)).toEqual({ batch: [] })
      }
    )

    it('has no zstd when zlib has no zstdCompress', async () => {
      const compressor = createZlibCompressor({ gzip: zlib.gzip, deflate: zlib.deflate })

      expect(compressor.supports('zstd')).toBe(false)
      expect(compressor.supports('gzip')).toBe(true)
      expect(await compressor.compress('{}', 'zstd')).toBeNull()
    })
  })

  describe('webCompressor', () => {
    it('has no zstd', () => {
      expect(webCompressor.supports('zstd')).toBe(false)
    })

    it.each<CaptureCodec>(['gzip', 'deflate'])('compresses with %s through CompressionStream', async (codec) => {
      expect(webCompressor.supports(codec)).toBe(true)
      expect(decode(codec, (await webCompressor.compress('{"batch":[]}', codec))!)).toEqual({ batch: [] })
    })
  })

  describe('resolveCaptureCodec', () => {
    it.each<[CaptureCompression, CaptureCodec[], CaptureCompression, boolean]>([
      ['none', ['gzip', 'deflate', 'zstd'], 'none', false],
      ['gzip', ['gzip', 'deflate', 'zstd'], 'gzip', false],
      ['deflate', ['gzip', 'deflate'], 'deflate', false],
      ['zstd', ['gzip', 'deflate', 'zstd'], 'zstd', false],
      ['zstd', ['gzip', 'deflate'], 'gzip', true],
      ['zstd', [], 'none', true],
      ['gzip', [], 'none', false],
      ['deflate', [], 'none', false],
    ])('resolves %s with %j available to %s', (requested, supported, expected, reportsZstd) => {
      const onZstdUnavailable = vi.fn()

      expect(resolveCaptureCodec(requested, fakeCompressor(supported), onZstdUnavailable)).toBe(expected)
      expect(onZstdUnavailable.mock.calls).toEqual(reportsZstd ? [[expected]] : [])
    })
  })

  describe('on the client', () => {
    const harness = new V1WiringHarness()

    beforeEach(() => {
      vi.useFakeTimers()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      harness.useDefaultRouting()
    })

    afterEach(async () => {
      await harness.cleanup()
      vi.clearAllMocks()
    })

    async function encodings(posthog: PostHog | EdgePostHog): Promise<{ analytics?: string; ai?: string }> {
      posthog.capture({ distinctId: 'u', event: 'analytics-event', properties: {} })
      posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {} })
      await posthog.flush()
      const encodingOf = (path: string, event: string): string | undefined => {
        const [, options] = harness.callsTo(path)[0]
        const encoding = options.headers['Content-Encoding']
        expect(decode(encoding, options.body).batch[0].event).toBe(event)
        return encoding
      }
      return {
        analytics: encodingOf(ANALYTICS_CAPTURE_PATH, 'analytics-event'),
        ai: encodingOf(AI_CAPTURE_PATH, '$ai_generation'),
      }
    }

    it.each<[string, PostHogOptions, string | undefined, string | undefined]>([
      ['the defaults', {}, 'gzip', 'gzip'],
      ['disableCompression', { disableCompression: true }, undefined, 'gzip'],
      [
        'captureCompression over disableCompression',
        { disableCompression: true, captureCompression: 'deflate' },
        'deflate',
        'gzip',
      ],
      ['captureCompression none', { captureCompression: 'none' }, undefined, 'gzip'],
      [
        'captureAiCompression alone on the AI lane',
        { disableCompression: true, captureCompression: 'none', captureAiCompression: 'deflate' },
        undefined,
        'deflate',
      ],
      ['captureAiCompression none', { captureAiCompression: 'none' }, 'gzip', undefined],
      ...(hasZstd
        ? ([
            ['zstd on both lanes', { captureCompression: 'zstd', captureAiCompression: 'zstd' }, 'zstd', 'zstd'],
          ] as const)
        : []),
    ])('uses %s', async (_label, options, analytics, ai) => {
      // The harness turns compression off on both lanes; these cases set it explicitly.
      const posthog = harness.makeClient({ disableCompression: undefined, captureAiCompression: undefined, ...options })

      expect(await encodings(posthog)).toEqual({ analytics, ai })
      expect(console.error).not.toHaveBeenCalled()
    })

    it.each<[keyof PostHogOptions, PostHogOptions, { analytics?: string; ai?: string }]>([
      [
        'captureCompression',
        { captureCompression: 'br' as 'gzip', disableCompression: true },
        { analytics: undefined, ai: 'gzip' },
      ],
      ['captureAiCompression', { captureAiCompression: 'br' as 'gzip' }, { analytics: 'gzip', ai: 'gzip' }],
    ])('logs one error for an invalid %s and uses the default', async (name, options, expected) => {
      const posthog = harness.makeClient({ disableCompression: undefined, captureAiCompression: undefined, ...options })

      expect(await encodings(posthog)).toEqual(expected)
      expect((console.error as vi.Mock).mock.calls).toEqual([
        [`[PostHog] ${name} must be one of 'none', 'gzip', 'deflate', 'zstd'; using the default.`],
      ])
    })

    it('compresses through CompressionStream on the edge build, with gzip in place of zstd', async () => {
      const posthog = new EdgePostHog('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        captureCompression: 'zstd',
        captureAiCompression: 'deflate',
      })

      expect(await encodings(posthog)).toEqual({ analytics: 'gzip', ai: 'deflate' })
      await posthog.shutdown()
    })

    it('sends gzip, with one debug log per lane, when zstd is not available', async () => {
      class PostHogWithoutZstd extends PostHog {
        protected override captureCompressor(): CaptureCompressor {
          return createZlibCompressor({ gzip: zlib.gzip, deflate: zlib.deflate })
        }
      }
      const posthog = new PostHogWithoutZstd('TEST_API_KEY', {
        host: 'http://example.com',
        fetchRetryCount: 0,
        captureCompression: 'zstd',
        captureAiCompression: 'zstd',
      })
      const debug = vi.spyOn((posthog as any)._logger, 'debug')

      expect(await encodings(posthog)).toEqual({ analytics: 'gzip', ai: 'gzip' })
      expect(debug.mock.calls.filter(([message]) => String(message).includes('zstd'))).toEqual([
        [`zstd compression is not available in this runtime; ${ANALYTICS_CAPTURE_PATH} uses gzip instead`],
        [`zstd compression is not available in this runtime; ${AI_CAPTURE_PATH} uses gzip instead`],
      ])
      await posthog.shutdown()
    })
  })
})
