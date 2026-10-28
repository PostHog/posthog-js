// @vitest-environment jsdom
import { convertToURL } from '../../src/utils/convert-to-url'
import { convertToURL as legacyConvertToURL } from '../../src/utils/request-utils'

afterEach(() => vi.unstubAllGlobals())

it('retains the request utility export and anchor-based relative URL resolution', () => {
    const expected = document.createElement('a')
    expected.href = '../path?query=1#fragment'
    const actual = convertToURL('../path?query=1#fragment')
    expect(legacyConvertToURL).toBe(convertToURL)
    expect(actual?.tagName).toBe('A')
    expect(actual?.href).toBe(expected.href)
    expect(actual?.host).toBe(expected.host)
})

it('returns null without a document and resolves the document only when called', () => {
    const original = document
    vi.stubGlobal('document', undefined)
    expect(convertToURL('/path')).toBeNull()
    vi.stubGlobal('document', original)
    expect(convertToURL('/path')?.pathname).toBe('/path')
})
