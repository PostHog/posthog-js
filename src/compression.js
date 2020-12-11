import { strToU8, gzipSync } from 'fflate'

export function decideCompression() {
    return 'gzip-js'
}

export function compressData(compression, jsonData, options) {
    // :TRICKY: This returns an UInt8Array. We don't encode this to a string - returning a blob will do this for us.
    return [
        gzipSync(strToU8(jsonData), { mtime: 0 }),
        { ...options, blob: true, urlQueryArgs: { compression: 'gzip-js' } },
    ]
}
