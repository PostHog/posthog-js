import { isGzipSupported, gzipCompress } from '@/gzip'
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
    it('should return false if CompressStream not available', () => {
      const CompressionStream = globalThis.CompressionStream
      delete (globalThis as any).CompressionStream
      expect(isGzipSupported()).toBe(false)
      ;(globalThis as any).CompressionStream = CompressionStream
    })
  })
  describe('gzipCompress', () => {
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
