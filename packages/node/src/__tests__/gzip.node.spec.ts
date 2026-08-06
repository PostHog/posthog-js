jest.mock('node:zlib', () => ({
  gzip: (_input: string, callback: (error: Error) => void) => callback(new Error('compression failed')),
}))

import { gzipCompress } from '@/gzip.node'

describe('Node gzip compression', () => {
  it('falls back when zlib compression fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await expect(gzipCompress('payload')).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('Failed to gzip compress data', expect.any(Error))

    errorSpy.mockRestore()
  })
})
