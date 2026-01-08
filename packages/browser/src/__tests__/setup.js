if (typeof globalThis.TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util')
    globalThis.TextEncoder = TextEncoder
    globalThis.TextDecoder = TextDecoder
}

const MockReadableStream = globalThis.__MockReadableStream
const blobDataMap = new WeakMap()
const OriginalBlob = globalThis.Blob

const combineChunks = (chunks) => {
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
    }
    return combined
}

if (MockReadableStream && OriginalBlob) {
    class PatchedBlob extends OriginalBlob {
        constructor(parts, options) {
            super(parts, options)
            if (parts && parts.length > 0) {
                const encoder = new TextEncoder()
                const uint8Arrays = parts.map((part) => {
                    if (typeof part === 'string') {
                        return encoder.encode(part)
                    } else if (part instanceof Uint8Array) {
                        return part
                    } else if (part instanceof ArrayBuffer) {
                        return new Uint8Array(part)
                    } else if (part instanceof OriginalBlob) {
                        return blobDataMap.get(part) || new Uint8Array(0)
                    }
                    return new Uint8Array(0)
                })
                blobDataMap.set(this, combineChunks(uint8Arrays))
            }
        }

        stream() {
            const data = blobDataMap.get(this)
            return new MockReadableStream(data ? [data] : [])
        }
    }
    globalThis.Blob = PatchedBlob
}

if (MockReadableStream) {
    const OriginalResponse = globalThis.Response
    if (OriginalResponse) {
        class PatchedResponse extends OriginalResponse {
            constructor(body, init) {
                if (body instanceof MockReadableStream) {
                    const combined = combineChunks(body._chunks)
                    super(combined, init)
                    this._mockData = combined
                } else {
                    super(body, init)
                }
            }

            async blob() {
                if (this._mockData) {
                    return new OriginalBlob([this._mockData])
                }
                return OriginalResponse.prototype.blob.call(this)
            }
        }
        globalThis.Response = PatchedResponse
    } else {
        class MockResponse {
            constructor(body, init) {
                if (body instanceof MockReadableStream) {
                    this._mockData = combineChunks(body._chunks)
                } else if (body instanceof Uint8Array) {
                    this._mockData = body
                } else if (typeof body === 'string') {
                    this._mockData = new TextEncoder().encode(body)
                } else {
                    this._mockData = new Uint8Array(0)
                }
                this.status = init?.status || 200
                this.ok = this.status >= 200 && this.status < 300
            }

            async blob() {
                return new globalThis.Blob([this._mockData])
            }
        }
        globalThis.Response = MockResponse
    }
}

beforeEach(() => {
    try {
        const { _resetSendChain } = require('../request')
        _resetSendChain()
    } catch {
        // request module may not be loaded in all tests
    }

    // eslint-disable-next-line no-console
    console.error = (...args) => {
        throw new Error(`Unexpected console.error: ${args}`)
    }
    // eslint-disable-next-line no-console
    console.warn = (...args) => {
        throw new Error(`Unexpected console.warn: ${args}`)
    }
})
