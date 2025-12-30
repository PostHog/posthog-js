const { gzipSync } = require('fflate')

class MockReadableStream {
    constructor(chunks = []) {
        this._chunks = chunks && typeof chunks.length === 'number' ? chunks : []
    }

    pipeThrough(transform) {
        const sink = transform.writable._underlyingSink
        for (const chunk of this._chunks) {
            sink.write(chunk)
        }
        sink.close()
        return transform.readable
    }
}

class MockWritableStream {
    constructor(underlyingSink) {
        this._underlyingSink = underlyingSink
    }
}

class MockCompressionStream {
    constructor() {
        const chunks = []
        const readableChunks = []

        this.readable = new MockReadableStream(readableChunks)
        this.writable = new MockWritableStream({
            write(chunk) {
                chunks.push(chunk)
            },
            close() {
                const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
                const combined = new Uint8Array(totalLength)
                let offset = 0
                for (const chunk of chunks) {
                    combined.set(chunk, offset)
                    offset += chunk.length
                }
                readableChunks.push(gzipSync(combined, { mtime: 0 }))
            },
        })
    }
}

globalThis.__MockReadableStream = MockReadableStream
globalThis.CompressionStream = MockCompressionStream
globalThis.ReadableStream = globalThis.ReadableStream || MockReadableStream
globalThis.WritableStream = globalThis.WritableStream || MockWritableStream
