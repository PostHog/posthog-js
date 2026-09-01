let mockFailCompression = false

jest.mock('node:zlib', () => {
  const actual = jest.requireActual<typeof import('node:zlib')>('node:zlib')
  return {
    ...actual,
    gzip: (input: Buffer | string, callback: (error: Error | null, result?: Buffer) => void) =>
      mockFailCompression ? callback(new Error('compression failed')) : actual.gzip(input, callback),
  }
})

import { gunzipSync } from 'node:zlib'
import { gzipCompress } from '@/gzip.node'

describe('Node gzip compression', () => {
  afterEach(() => {
    mockFailCompression = false
  })

  it('returns the gzip bytes rather than a Blob', async () => {
    const payload = JSON.stringify({ batch: [{ event: 'custom' }] })

    const compressed = await gzipCompress(payload)

    // A Blob body leaks a native BlobReader per request on Node >= 24.16 (nodejs/node#63574)
    expect(compressed).toBeInstanceOf(Uint8Array)
    expect(compressed).not.toBeInstanceOf(Blob)
    expect(gunzipSync(compressed!).toString()).toBe(payload)
  })

  it('falls back when zlib compression fails', async () => {
    mockFailCompression = true
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await expect(gzipCompress('payload')).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('Failed to gzip compress data', expect.any(Error))

    errorSpy.mockRestore()
  })
})
