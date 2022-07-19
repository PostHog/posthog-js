import { LZString } from './lz-string'
import { gzipSync, strToU8 } from 'fflate'
import { _base64Encode } from './utils'
import { Compression, CompressionData, XHROptions } from './types'

export function decideCompression(compressionSupport: Partial<Record<Compression, boolean>>): Compression {
    if (compressionSupport[Compression.GZipJS]) {
        return Compression.GZipJS
    } else if (compressionSupport[Compression.LZ64]) {
        return Compression.LZ64
    } else {
        return Compression.Base64
    }
}

export function compressData(
    compression: Compression,
    jsonData: string,
    options: XHROptions
): [CompressionData | Uint8Array, XHROptions] {
    if (compression === Compression.LZ64) {
        return [{ data: LZString.compressToBase64(jsonData), compression: Compression.LZ64 }, options]
    } else if (compression === Compression.GZipJS) {
        // :TRICKY: This returns an UInt8Array. We don't encode this to a string - returning a blob will do this for us.
        return [
            gzipSync(strToU8(jsonData), { mtime: 0 }),
            { ...options, blob: true, urlQueryArgs: { compression: Compression.GZipJS } },
        ]
    } else {
        return [{ data: _base64Encode(jsonData) }, options]
    }
}
