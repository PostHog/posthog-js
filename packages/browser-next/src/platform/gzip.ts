let gzipCrcTable: number[] | undefined
const gzipCrc32 = (bytes: Uint8Array): number => {
    if (!gzipCrcTable) {
        gzipCrcTable = Array.from({ length: 256 }, (_, value) => {
            let crc = value
            for (let bit = 0; bit < 8; bit++) {
                crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
            }
            return crc >>> 0
        })
    }
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc = gzipCrcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

/** Gzips with the browser's CompressionStream, verified against the input; `undefined` when unavailable or invalid. */
export const nativeGzip = async (payload: string): Promise<Blob | undefined> => {
    try {
        const CompressionStreamConstructor = globalThis.CompressionStream
        const TextEncoderConstructor = globalThis.TextEncoder
        const ResponseConstructor = globalThis.Response
        if (
            typeof CompressionStreamConstructor !== 'function' ||
            typeof TextEncoderConstructor !== 'function' ||
            typeof ResponseConstructor !== 'function'
        ) {
            return undefined
        }

        const input = new TextEncoderConstructor().encode(payload)
        const stream = new CompressionStreamConstructor('gzip')
        const writer = stream.writable.getWriter()
        const write = writer
            .write(input)
            .then(() => writer.close())
            .catch(async (error) => {
                try {
                    await writer.abort(error)
                } catch {
                    // Preserve the original compression failure.
                }
                throw error
            })
        const compressed = await Promise.all([new ResponseConstructor(stream.readable).blob(), write]).then(
            ([blob]) => blob
        )
        if (compressed.size < 18) {
            return undefined
        }
        const [headerBuffer, trailerBuffer] = await Promise.all([
            compressed.slice(0, 3).arrayBuffer(),
            compressed.slice(compressed.size - 8).arrayBuffer(),
        ])
        const header = new Uint8Array(headerBuffer)
        const trailer = new DataView(trailerBuffer)
        return header[0] === 0x1f &&
            header[1] === 0x8b &&
            header[2] === 0x08 &&
            trailer.getUint32(0, true) === gzipCrc32(input) &&
            trailer.getUint32(4, true) === input.length >>> 0
            ? compressed
            : undefined
    } catch {
        return undefined
    }
}
