/**
 * Older browsers and some runtimes don't support this yet
 * This API (as of 2025-05-07) is not available on React Native.
 */
export function isGzipSupported(): boolean {
  return (
    'CompressionStream' in globalThis &&
    'TextEncoder' in globalThis &&
    'Response' in globalThis &&
    typeof Response.prototype.blob === 'function'
  )
}

export const isNativeAsyncGzipReadError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const name = 'name' in error ? String(error.name) : ''

  return name === 'NotReadableError'
}

export type GzipCompressOptions = {
  /**
   * By default this helper swallows compression errors and returns null.
   * Some browsers, notably Safari 16, can throw NotReadableError from the
   * native CompressionStream path. Callers can opt into rethrowing so they
   * can detect that case and change future compression behavior if needed.
   */
  rethrow?: boolean
}

/**
 * Gzip a string using Compression Streams API if it's available
 */
export async function gzipCompress(input: string, isDebug = true, options?: GzipCompressOptions): Promise<Blob | null> {
  try {
    const compressedStream = new CompressionStream('gzip')
    const writer = compressedStream.writable.getWriter()

    const writePromise = writer
      .write(new TextEncoder().encode(input))
      .then(() => writer.close())
      .catch(async (err) => {
        try {
          await writer.abort(err)
        } catch {
          // Ignore abort failures and rethrow the original compression error below.
        }
        throw err
      })
    const responsePromise = new Response(compressedStream.readable).blob()

    const [compressed] = await Promise.all([responsePromise, writePromise])
    return compressed
  } catch (error) {
    if (options?.rethrow) {
      throw error
    }

    if (isDebug) {
      console.error('Failed to gzip compress data', error)
    }
    return null
  }
}
