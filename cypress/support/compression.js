import * as fflate from 'fflate'
import { LZString } from '../../src/lz-string'

export function getBase64EncodedPayload(request) {
    const data = decodeURIComponent(request.body.match(/data=(.*)/)[1])
    return JSON.parse(Buffer.from(data, 'base64'))
}

export function getLZStringEncodedPayload(request) {
    const data = decodeURIComponent(request.body.match(/data=(.*)&compression=lz64/)[1])
    return JSON.parse(LZString.decompressFromBase64(data))
}

export async function getGzipEncodedPayload(requestBody) {
    const data = new Uint8Array(await requestBody.arrayBuffer())
    const decoded = fflate.strFromU8(fflate.decompressSync(data))
    return JSON.parse(decoded)
}
