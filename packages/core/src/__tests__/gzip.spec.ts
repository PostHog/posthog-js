import {
  isGzipSupported,
  gzipCompress,
  isGzipData,
  isGzipRequest,
  isNativeAsyncGzipError,
  isNativeAsyncGzipReadError,
  __resetNativeGzipTrustForTests,
} from '@/gzip'
import { gzip } from 'node:zlib'
import { randomBytes, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const RANDOM_TEST_INPUT = JSON.stringify({
  abc: randomBytes(16),
  def: randomBytes(64),
})
const API_TEST_INPUT = JSON.stringify({
  api_key: 'TEST_API_KEY',
  batch: [
    {
      event: 'custom-event',
      distinct_id: 'user-distinct-id',
      properties: {
        $lib: 'posthog-core-tests',
        $lib_version: '2.0.0-alpha',
        $session_id: 'session.id',
      },
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
    },
  ],
  sent_at: new Date().toISOString(),
})

describe('gzip', () => {
  describe('isGzipSupported', () => {
    it('should return true if CompressStream exists', () => {
      expect(globalThis.CompressionStream).toBeDefined()
      expect(isGzipSupported()).toBe(true)
    })
    it.each([
      [
        'CompressionStream',
        () => {
          const CompressionStream = globalThis.CompressionStream
          delete (globalThis as any).CompressionStream
          return () => ((globalThis as any).CompressionStream = CompressionStream)
        },
      ],
      [
        'TextEncoder',
        () => {
          const TextEncoder = globalThis.TextEncoder
          delete (globalThis as any).TextEncoder
          return () => ((globalThis as any).TextEncoder = TextEncoder)
        },
      ],
      [
        'Response.blob',
        () => {
          const blob = globalThis.Response.prototype.blob
          delete (globalThis.Response.prototype as any).blob
          return () => ((globalThis.Response.prototype as any).blob = blob)
        },
      ],
    ])('should return false if %s not available', (_name, removeDependency) => {
      const restoreDependency = removeDependency()

      try {
        expect(isGzipSupported()).toBe(false)
      } finally {
        restoreDependency()
      }
    })
  })
  describe('isGzipData', () => {
    it.each([
      ['ArrayBuffer with gzip magic', new Uint8Array([0x1f, 0x8b]).buffer, true],
      ['ArrayBufferView with gzip magic', new Uint8Array([0, 0x1f, 0x8b]).subarray(1), true],
      ['ArrayBuffer without gzip magic', new Uint8Array([0, 1, 2]).buffer, false],
      ['string body', 'not gzip', false],
      ['Blob body', new Blob([new Uint8Array([0x1f, 0x8b])]), false],
    ])('returns %s => %s', (_name, input, expected) => {
      expect(isGzipData(input)).toBe(expected)
    })
  })
  describe('isGzipRequest', () => {
    it.each([
      ['option gzip-js', 'gzip-js', undefined, true],
      ['url gzip-js', undefined, 'gzip-js', true],
      ['url gzip', undefined, 'gzip', true],
      ['base64', 'base64', 'base64', false],
      ['no compression', undefined, undefined, false],
    ])('returns %s => %s', (_name, compression, urlCompression, expected) => {
      expect(isGzipRequest(compression, urlCompression)).toBe(expected)
    })
  })
  describe('isNativeAsyncGzipReadError', () => {
    it('returns true for NotReadableError', () => {
      expect(isNativeAsyncGzipReadError({ name: 'NotReadableError' })).toBe(true)
      expect(isNativeAsyncGzipError({ name: 'NotReadableError' })).toBe(true)
    })

    it('returns true for native gzip validation errors', () => {
      expect(isNativeAsyncGzipReadError({ name: 'NativeGzipValidationError' })).toBe(false)
      expect(isNativeAsyncGzipError({ name: 'NativeGzipValidationError' })).toBe(true)
    })

    it('returns false for other errors', () => {
      expect(isNativeAsyncGzipReadError({ name: 'TypeError' })).toBe(false)
      expect(isNativeAsyncGzipError({ name: 'TypeError' })).toBe(false)
      expect(isNativeAsyncGzipReadError(null)).toBe(false)
      expect(isNativeAsyncGzipError(null)).toBe(false)
    })
  })
  describe('gzipCompress', () => {
    beforeEach(() => __resetNativeGzipTrustForTests())

    it('rethrows errors when requested', async () => {
      const CompressionStream = globalThis.CompressionStream
      delete (globalThis as any).CompressionStream

      await expect(gzipCompress(RANDOM_TEST_INPUT, false, { rethrow: true })).rejects.toThrow()
      ;(globalThis as any).CompressionStream = CompressionStream
    })

    it('does not read input using Blob.stream', async () => {
      const blobStream = Blob.prototype.stream
      Blob.prototype.stream = vi.fn(() => {
        throw new Error('Blob.stream should not be used')
      })

      try {
        const compressed = await gzipCompress(API_TEST_INPUT, false, { rethrow: true })
        expect(compressed).not.toBe(null)
      } finally {
        Blob.prototype.stream = blobStream
      }
    })

    it('aborts the compression writer when writing input fails', async () => {
      const CompressionStream = globalThis.CompressionStream
      const writeError = new Error('write failed')
      const abort = vi.fn(() => Promise.resolve())

      ;(globalThis as any).CompressionStream = vi.fn(() => ({
        writable: {
          getWriter: () => ({
            write: () => Promise.reject(writeError),
            close: vi.fn(),
            abort,
          }),
        },
        readable: new ReadableStream(),
      }))

      try {
        await expect(gzipCompress(API_TEST_INPUT, false, { rethrow: true })).rejects.toBe(writeError)
        expect(abort).toHaveBeenCalledWith(writeError)
      } finally {
        ;(globalThis as any).CompressionStream = CompressionStream
      }
    })

    const withNativeOutput = async (output: Uint8Array, run: () => Promise<void>): Promise<void> => {
      const CompressionStream = globalThis.CompressionStream
      ;(globalThis as any).CompressionStream = vi.fn(() => ({
        writable: new WritableStream(),
        readable: new ReadableStream({
          start(controller) {
            controller.enqueue(output)
            controller.close()
          },
        }),
      }))
      try {
        await run()
      } finally {
        ;(globalThis as any).CompressionStream = CompressionStream
      }
    }

    const expectValidationError = (result: Promise<unknown>): Promise<void> =>
      expect(result).rejects.toHaveProperty('name', 'NativeGzipValidationError')

    const nodeGzipWithFlippedTrailerByte = async (offsetFromEnd: 8 | 4): Promise<Uint8Array> => {
      const bytes = new Uint8Array(await promisify(gzip)(API_TEST_INPUT))
      bytes[bytes.length - offsetFromEnd] ^= 0xff
      return bytes
    }

    it('rejects malformed native gzip output when no stream error is thrown', async () => {
      await withNativeOutput(new Uint8Array([1, 2, 3, 4]), () =>
        expectValidationError(gzipCompress(API_TEST_INPUT, false, { rethrow: true }))
      )
    })

    const compressGoodInputs = async (count: number): Promise<void> => {
      for (let i = 0; i < count; i++) {
        await gzipCompress(API_TEST_INPUT, false, { rethrow: true })
      }
    }

    it('stops checking the crc once native gzip has passed it, but keeps checking the size', async () => {
      await compressGoodInputs(3)

      await withNativeOutput(await nodeGzipWithFlippedTrailerByte(8), async () => {
        await expect(gzipCompress(API_TEST_INPUT, false, { rethrow: true })).resolves.not.toBeNull()
      })
      await withNativeOutput(await nodeGzipWithFlippedTrailerByte(4), () =>
        expectValidationError(gzipCompress(API_TEST_INPUT, false, { rethrow: true }))
      )
    })

    it('keeps checking the crc for the page once native gzip has failed it', async () => {
      const badCrc = await nodeGzipWithFlippedTrailerByte(8)

      await withNativeOutput(badCrc, () =>
        expectValidationError(gzipCompress(API_TEST_INPUT, false, { rethrow: true }))
      )
      await compressGoodInputs(3)
      await withNativeOutput(badCrc, () =>
        expectValidationError(gzipCompress(API_TEST_INPUT, false, { rethrow: true }))
      )
    })

    it('compressed random data should match node', async () => {
      const compressed = await gzipCompress(RANDOM_TEST_INPUT)
      expect(compressed).not.toBe(null)
      if (!compressed) {
        return
      }
      const webCompress = Buffer.from(await compressed.arrayBuffer())
      const nodeCompress = await promisify(gzip)(RANDOM_TEST_INPUT)
      expect(webCompress).not.toBeFalsy()
      expect(webCompress).toEqual(nodeCompress)
    })

    it('compressed mock request should match node', async () => {
      const compressed = await gzipCompress(API_TEST_INPUT)
      expect(compressed).not.toBe(null)
      if (!compressed) {
        return
      }
      const webCompress = Buffer.from(await compressed.arrayBuffer())
      const nodeCompress = await promisify(gzip)(API_TEST_INPUT)
      expect(webCompress).not.toBeFalsy()
      expect(webCompress).toEqual(nodeCompress)
    })
  })
})
