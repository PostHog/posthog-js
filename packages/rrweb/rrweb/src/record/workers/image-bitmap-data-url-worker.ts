import { encode } from 'base64-arraybuffer'
import type {
    DataURLOptions,
    ImageBitmapDataURLWorkerParams,
    ImageBitmapDataURLWorkerResponse,
} from '@posthog/rrweb-types'

const lastFingerprintMap: Map<number, number> = new Map()
const transparentBlobMap: Map<string, string> = new Map()

export interface ImageBitmapDataURLRequestWorker {
    postMessage: (message: ImageBitmapDataURLWorkerParams, transfer?: [ImageBitmap]) => void
    onmessage: (message: MessageEvent<ImageBitmapDataURLWorkerResponse>) => void
}

interface ImageBitmapDataURLResponseWorker {
    onmessage: null | ((message: MessageEvent<ImageBitmapDataURLWorkerParams>) => void)
    postMessage(e: ImageBitmapDataURLWorkerResponse): void
}

function fnv1aHash(data: Uint8ClampedArray): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < data.length; i += 4) {
        hash ^= data[i]
        hash = (hash * 0x01000193) >>> 0
    }
    return hash
}

let reusableCanvas: OffscreenCanvas | null = null
let reusableCtx: OffscreenCanvasRenderingContext2D | null = null

async function getTransparentBlobFor(width: number, height: number, dataURLOptions: DataURLOptions): Promise<string> {
    const id = `${width}-${height}`
    if ('OffscreenCanvas' in globalThis) {
        if (transparentBlobMap.has(id)) return transparentBlobMap.get(id)!
        const offscreen = new OffscreenCanvas(width, height)
        offscreen.getContext('2d')
        const blob = await offscreen.convertToBlob(dataURLOptions)
        const arrayBuffer = await blob.arrayBuffer()
        const base64 = encode(arrayBuffer)
        transparentBlobMap.set(id, base64)
        return base64
    } else {
        return ''
    }
}

// `as any` because: https://github.com/Microsoft/TypeScript/issues/20595
const worker: ImageBitmapDataURLResponseWorker = self

// eslint-disable-next-line @typescript-eslint/no-misused-promises
worker.onmessage = async function (e) {
    if ('OffscreenCanvas' in globalThis) {
        const { id, bitmap, width, height, dataURLOptions } = e.data

        const transparentBase64 = getTransparentBlobFor(width, height, dataURLOptions)

        if (!reusableCanvas || reusableCanvas.width !== width || reusableCanvas.height !== height) {
            reusableCanvas = new OffscreenCanvas(width, height)
            reusableCtx = reusableCanvas.getContext('2d')!
        }

        reusableCtx!.clearRect(0, 0, width, height)
        reusableCtx!.drawImage(bitmap, 0, 0)

        const imageData = reusableCtx!.getImageData(0, 0, width, height)
        const fingerprint = fnv1aHash(imageData.data)

        if (!lastFingerprintMap.has(id)) {
            const blob = await reusableCanvas.convertToBlob(dataURLOptions)
            const type = blob.type
            const arrayBuffer = await blob.arrayBuffer()
            const base64 = encode(arrayBuffer)

            if ((await transparentBase64) === base64) {
                lastFingerprintMap.set(id, fingerprint)
                bitmap.close()
                return worker.postMessage({ id })
            }

            lastFingerprintMap.set(id, fingerprint)
            bitmap.close()
            return worker.postMessage({
                id,
                type,
                base64,
                width,
                height,
            })
        }

        if (lastFingerprintMap.get(id) === fingerprint) {
            bitmap.close()
            return worker.postMessage({ id })
        }

        lastFingerprintMap.set(id, fingerprint)
        bitmap.close()
        const blob = await reusableCanvas.convertToBlob(dataURLOptions)
        const type = blob.type
        const arrayBuffer = await blob.arrayBuffer()
        const base64 = encode(arrayBuffer)
        worker.postMessage({
            id,
            type,
            base64,
            width,
            height,
        })
    } else {
        return worker.postMessage({ id: e.data.id })
    }
}
