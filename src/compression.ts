import { LZString } from './lz-string'
import { strToU8, gzipSync } from 'fflate'
import { _base64Encode } from './utils'

export function decideCompression(compressionSupport) {
    if (compressionSupport['gzip-js']) {
        return 'gzip-js'
    } else if (compressionSupport['lz64']) {
        return 'lz64'
    } else {
        return 'base64'
    }
}

export function compressData(compression, jsonData, options) {
    if (compression === 'lz64') {
        return [{ data: LZString.compressToBase64(jsonData), compression: 'lz64' }, options]
    } else if (compression === 'gzip-js') {
        // :TRICKY: This returns an UInt8Array. We don't encode this to a string - returning a blob will do this for us.
        return [
            gzipSync(strToU8(jsonData), { mtime: 0 }),
            { ...options, blob: true, urlQueryArgs: { compression: 'gzip-js' } },
        ]
    } else {
        return [{ data: _base64Encode(jsonData) }, options]
    }
}
