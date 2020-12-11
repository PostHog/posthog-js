import { strToU8, gzipSync } from 'fflate'
import { _ } from './utils'

export function decideCompression(compressionSupport) {
    if (compressionSupport['gzip-js']) {
        return 'gzip-js'
    } else {
        return 'base64'
    }
}

export function compressData(compression, jsonData, options) {
    if (compression === 'gzip-js') {
        // :TRICKY: This returns an UInt8Array. We don't encode this to a string - returning a blob will do this for us.
        return [
            gzipSync(strToU8(jsonData), { mtime: 0 }),
            { ...options, blob: true, urlQueryArgs: { compression: 'gzip-js' } },
        ]
    } else {
        return [{ data: _.base64Encode(jsonData) }, options]
    }
}
