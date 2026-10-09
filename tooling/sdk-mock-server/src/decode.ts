import type { IncomingHttpHeaders } from 'node:http'
import { gunzipSync } from 'node:zlib'
import type { JsonValue } from './state.js'

export interface DecodedBody {
    body: JsonValue
    bodyWrapper: 'empty' | 'json' | 'gzip' | 'form-json' | 'form-base64' | 'base64'
}

function base64Bytes(value: string): Buffer {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new Error('Invalid base64 body')
    }
    return Buffer.from(value, 'base64')
}

/** Node's HTTP parser has already removed chunk framing; raw bytes are retained by the server. */
export function decodeBody(raw: Buffer, headers: IncomingHttpHeaders, url: URL): DecodedBody {
    if (!raw.length) return { body: null, bodyWrapper: 'empty' }
    const compression = url.searchParams.get('compression')
    if (compression && !['base64', 'gzip', 'gzip-js'].includes(compression)) {
        throw new Error(`Unsupported compression: ${compression}`)
    }
    const encoding = String(headers['content-encoding'] ?? '').toLowerCase()
    if (encoding && encoding !== 'gzip' && encoding !== 'identity')
        throw new Error(`Unsupported content encoding: ${encoding}`)
    const gzipped =
        encoding === 'gzip' ||
        compression === 'gzip' ||
        compression === 'gzip-js' ||
        (raw[0] === 0x1f && raw[1] === 0x8b)
    let bytes = gzipped ? gunzipSync(raw) : raw
    let bodyWrapper: DecodedBody['bodyWrapper'] = gzipped ? 'gzip' : 'json'
    const text = bytes.toString('utf8')
    if (
        String(headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded') ||
        text.startsWith('data=')
    ) {
        const data = new URLSearchParams(text).get('data')
        if (data === null) throw new Error('Missing form data field')
        if (compression !== 'base64') {
            try {
                return { body: JSON.parse(data) as JsonValue, bodyWrapper: 'form-json' }
            } catch {
                // Older browser clients send base64 form data without a compression query.
            }
        }
        bytes = base64Bytes(data)
        bodyWrapper = 'form-base64'
    } else if (compression === 'base64') {
        bytes = base64Bytes(text)
        bodyWrapper = 'base64'
    }
    return { body: JSON.parse(bytes.toString('utf8')) as JsonValue, bodyWrapper }
}
