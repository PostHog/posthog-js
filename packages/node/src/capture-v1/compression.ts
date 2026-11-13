import { gzipCompress, isGzipSupported } from '@posthog/core'

export const CAPTURE_COMPRESSIONS = ['none', 'gzip', 'deflate', 'zstd'] as const

/** A capture request body encoding; `deflate` is zlib-wrapped, as HTTP `Content-Encoding: deflate` requires. */
export type CaptureCompression = (typeof CAPTURE_COMPRESSIONS)[number]

export type CaptureCodec = Exclude<CaptureCompression, 'none'>

/** Compresses capture request bodies with the codecs one runtime provides. */
export interface CaptureCompressor {
  supports(codec: CaptureCodec): boolean
  /** Resolves to null, or rejects, when compression fails; the sender then sends the body uncompressed. */
  compress(payload: string, codec: CaptureCodec): Promise<Uint8Array | null>
}

/** Uses CompressionStream, so it works wherever the runtime has one. It has no zstd. */
export const webCompressor: CaptureCompressor = {
  supports: (codec) => codec !== 'zstd' && isGzipSupported(),
  async compress(payload, codec) {
    if (codec === 'gzip') {
      const compressed = await gzipCompress(payload, false)
      return compressed && new Uint8Array(await compressed.arrayBuffer())
    }
    if (codec !== 'deflate') {
      return null
    }
    const stream = new Response(payload).body!.pipeThrough(new globalThis.CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  },
}

/**
 * The codec a lane sends with: `requested` when the runtime has it, gzip in place of an unavailable
 * zstd, or no compression when the runtime cannot compress at all.
 */
export function resolveCaptureCodec(
  requested: CaptureCompression,
  compressor: CaptureCompressor,
  onZstdUnavailable: (fallback: CaptureCompression) => void
): CaptureCompression {
  if (requested === 'none' || compressor.supports(requested)) {
    return requested
  }
  const fallback = compressor.supports('gzip') ? 'gzip' : 'none'
  if (requested === 'zstd') {
    onZstdUnavailable(fallback)
  }
  return fallback
}
