// jsdom lacks the native gzip primitives; provide them before the recorder module
// computes its module-level support flag. Import this before any recorder import.
import { TextEncoder } from 'node:util'
import { CompressionStream } from 'node:stream/web'

const g = globalThis as any

if (!g.CompressionStream) {
    g.CompressionStream = CompressionStream
}
if (!g.TextEncoder) {
    g.TextEncoder = TextEncoder
}
if (!g.Response) {
    g.Response = class Response {
        private _body: any
        constructor(body: any) {
            this._body = body
        }
        async blob(): Promise<Blob> {
            const reader = this._body.getReader()
            const chunks: Uint8Array[] = []
            for (;;) {
                const { done, value } = await reader.read()
                if (done) {
                    break
                }
                chunks.push(value)
            }
            return new Blob(chunks as any)
        }
    }
}
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as ArrayBuffer)
            reader.onerror = () => reject(reader.error)
            reader.readAsArrayBuffer(this)
        })
    }
}
