import { decompressSync, strFromU8 } from 'fflate'

export function getBase64EncodedPayloadFromBody(body: unknown): Record<string, any> {
    if (typeof body !== 'string') {
        throw new Error('Expected body to be a string')
    }
    const data = decodeURIComponent(body.match(/data=(.*)/)[1])
    return JSON.parse(Buffer.from(data, 'base64').toString())
}

export function getBase64EncodedPayload(request) {
    return getBase64EncodedPayloadFromBody(request.body)
}

export async function getGzipEncodedPayload(request) {
    const data = new Uint8Array(await request.body)
    const decoded = strFromU8(decompressSync(data))
    return JSON.parse(decoded)
}

export async function getPayload(request) {
    if (request.url.includes('compression=gzip-js')) {
        return getGzipEncodedPayload(request)
    } else if (request.url.includes('compression=base64')) {
        return getBase64EncodedPayload(request)
    } else {
        return request.body
    }
}
