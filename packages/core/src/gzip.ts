/**
 * Older browsers and some runtimes don't support this yet
 * This API (as of 2025-05-07) is not available on React Native.
 */
export function isGzipSupported(): boolean {
  return 'CompressionStream' in globalThis
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
export async function gzipCompress(
  input: string,
  isDebug = true,
  options?: GzipCompressOptions
): Promise<Blob | null> {
  try {
    // Turn the string into a stream using a Blob, and then compress it
    const dataStream = new Blob([input], {
      type: 'text/plain',
    }).stream()

    const compressedStream = dataStream.pipeThrough(new CompressionStream('gzip'))

    // Using a Response to easily extract the readablestream value. Decoding into a string for fetch
    return await new Response(compressedStream).blob()
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
