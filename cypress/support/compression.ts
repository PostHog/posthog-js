import { decompressSync, strFromU8 } from 'fflate'

export function getBase64EncodedPayload(request) {
    const data = decodeURIComponent(request.body.match(/data=(.*)/)[1])
    return JSON.parse(Buffer.from(data, 'base64').toString())
}

export async function getGzipEncodedPayload(request) {
    const data = new Uint8Array(await request.body)
    const decoded = strFromU8(decompressSync(data))
    return JSON.parse(decoded)
}
