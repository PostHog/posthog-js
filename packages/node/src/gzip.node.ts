import type { PostHogFetchBodyBytes } from '@posthog/core'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)

export async function gzipCompress(input: string, isDebug = true): Promise<PostHogFetchBodyBytes | null> {
  try {
    const compressed = await gzipAsync(input)
    return new Uint8Array(compressed)
  } catch (error) {
    if (isDebug) {
      console.error('Failed to gzip compress data', error)
    }
    return null
  }
}
