import { isGzipSupported, gzipCompress, isNativeAsyncGzipReadError } from '@/gzip'
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
      library: 'posthog-core-tests',
      library_version: '2.0.0-alpha',
      properties: {
        $lib: 'posthog-core-tests',
        $lib_version: '2.0.0-alpha',
        $session_id: 'session.id',
      },
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      type: 'capture',
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
  describe('isNativeAsyncGzipReadError', () => {
    it('returns true for NotReadableError', () => {
      expect(isNativeAsyncGzipReadError({ name: 'NotReadableError' })).toBe(true)
    })

    it('returns false for other errors', () => {
      expect(isNativeAsyncGzipReadError({ name: 'TypeError' })).toBe(false)
      expect(isNativeAsyncGzipReadError(null)).toBe(false)
    })
  })
  describe('gzipCompress', () => {
    it('rethrows errors when requested', async () => {
      const CompressionStream = globalThis.CompressionStream
      delete (globalThis as any).CompressionStream

      await expect(gzipCompress(RANDOM_TEST_INPUT, false, { rethrow: true })).rejects.toThrow()
      ;(globalThis as any).CompressionStream = CompressionStream
    })

    it('does not read input using Blob.stream', async () => {
      const blobStream = Blob.prototype.stream
      Blob.prototype.stream = jest.fn(() => {
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
      const abort = jest.fn(() => Promise.resolve())

      ;(globalThis as any).CompressionStream = jest.fn(() => ({
        writable: {
          getWriter: () => ({
            write: () => Promise.reject(writeError),
            close: jest.fn(),
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
