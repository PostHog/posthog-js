import { decideCompression, compressData } from '../compression'

describe('decideCompression()', () => {
    given('subject', () => decideCompression(given.compressionSupport))
    given('compressionSupport', () => ({}))

    it('returns base64 by default', () => {
        expect(given.subject).toEqual('base64')
    })

    it('returns gzip-js if all compressions supported', () => {
        given('compressionSupport', () => ({
            'gzip-js': true,
            'a different thing that is either deprecated or new': true,
        }))

        expect(given.subject).toEqual('gzip-js')
    })

    it('returns base64 if only unexpected compression is received', () => {
        given('compressionSupport', () => ({ 'the new compression that is not supported yet': true }))

        expect(given.subject).toEqual('base64')
    })
})

describe('compressData()', () => {
    given('subject', () => compressData(given.compression, given.jsonData, given.options))

    given('jsonData', () => JSON.stringify({ large_key: new Array(500).join('abc') }))
    given('options', () => ({ method: 'POST' }))

    it('handles base64', () => {
        given('compression', () => 'base64')

        expect(given.subject).toMatchSnapshot()
    })

    it('handles gzip-js', () => {
        given('compression', () => 'gzip-js')

        expect(given.subject).toMatchSnapshot()
    })
})
