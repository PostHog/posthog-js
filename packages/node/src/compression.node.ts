import * as zlib from 'node:zlib'
import { promisify } from 'node:util'

import type { CaptureCodec, CaptureCompressor } from './capture-v1/compression'

type ZlibCompress = typeof zlib.gzip

/** The zlib functions the compressor uses; `zstdCompress` exists from Node 22.15. */
export interface ZlibCodecs {
  gzip: ZlibCompress
  deflate: ZlibCompress
  zstdCompress?: ZlibCompress
}

export function createZlibCompressor(codecs: ZlibCodecs = zlib as ZlibCodecs): CaptureCompressor {
  const compressors: Record<CaptureCodec, ((input: string) => Promise<Buffer>) | undefined> = {
    gzip: promisify(codecs.gzip),
    deflate: promisify(codecs.deflate),
    zstd: typeof codecs.zstdCompress === 'function' ? promisify(codecs.zstdCompress) : undefined,
  }
  return {
    supports: (codec) => compressors[codec] !== undefined,
    async compress(payload, codec) {
      const compress = compressors[codec]
      return compress ? new Uint8Array(await compress(payload)) : null
    },
  }
}

export const zlibCompressor = createZlibCompressor()
