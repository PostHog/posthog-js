import { compressData, decideCompression } from '../compression'
import { Compression, XHROptions } from '../types'

describe('decideCompression()', () => {
    it('returns base64 by default', () => {
        expect(decideCompression({})).toEqual('base64')
    })

    it('returns gzip-js if all compressions supported', () => {
        expect(
            decideCompression({
                'gzip-js': true,
                'a different thing that is either deprecated or new': true,
            } as unknown as Partial<Record<Compression, boolean>>)
        ).toEqual('gzip-js')
    })

    it('returns base64 if only unexpected compression is received', () => {
        expect(
            decideCompression({ 'the new compression that is not supported yet': true } as unknown as Partial<
                Record<Compression, boolean>
            >)
        ).toEqual('base64')
    })
})

describe('compressData()', () => {
    const jsonData = JSON.stringify({ large_key: new Array(500).join('abc') })
    const options: XHROptions = { method: 'POST' }

    it('handles base64', () => {
        expect(compressData(Compression.Base64, jsonData, options)).toMatchSnapshot()
    })

    it('handles gzip-js', () => {
        expect(compressData(Compression.GZipJS, jsonData, options)).toMatchSnapshot()
    })
})
