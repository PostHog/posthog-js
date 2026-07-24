import { _base64Encode } from '../../src/utils/encode-utils'

describe('_base64Encode', () => {
    it.each([
        [null, null],
        [undefined, undefined],
        ['', ''],
        ['Hello, World!', 'SGVsbG8sIFdvcmxkIQ=='],
        ['✓ à la mode', '4pyTIMOgIGxhIG1vZGU='],
    ])('encodes %p', (input, expected) => {
        expect((_base64Encode as (value: string | null | undefined) => string | null | undefined)(input)).toBe(expected)
    })
})
