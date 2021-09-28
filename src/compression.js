import { LZString } from './lz-string'
import { strToU8, gzipSync } from 'fflate'
import { _ } from './utils'

export function decideCompression(compressionSupport) {
    if (compressionSupport['gzip-js']) {
        return 'gzip-js'
    } else if (compressionSupport['lz64']) {
        return 'lz64'
    } else {
        return 'base64'
    }
}

function hasMagicGzipHeader(compressionResultElement) {
    try {
        const a = compressionResultElement[0]
        const b = compressionResultElement[1]
        return a === 31 && b === 139
    } catch (e) {
        return false
    }
}

export function compressData(compression, jsonData, options, captureMetrics) {
    if (compression === 'lz64') {
        return [{ data: LZString.compressToBase64(jsonData), compression: 'lz64' }, options]
    } else if (compression === 'gzip-js') {
        // :TRICKY: This returns an UInt8Array. We don't encode this to a string - returning a blob will do this for us.
        const compressionResult = [
            gzipSync(strToU8(jsonData), { mtime: 0 }),
            { ...options, blob: true, urlQueryArgs: { compression: 'gzip-js' } },
        ]

        // temporary logging to identify source of https://github.com/PostHog/posthog/issues/4816
        if (
            !jsonData ||
            jsonData === 'undefined' ||
            !compressionResult[0] ||
            !hasMagicGzipHeader(compressionResult[0])
        ) {
            captureMetrics.addDebugMessage('PostHogJSCompressionCannotBeDecompressed', {
                jsonData,
                compressionResult: compressionResult[0],
            })
        }

        return compressionResult
    } else {
        return [{ data: _.base64Encode(jsonData) }, options]
    }
}
