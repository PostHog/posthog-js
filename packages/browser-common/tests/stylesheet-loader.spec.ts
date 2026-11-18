// @vitest-environment jsdom
import { prepareStylesheet } from '../src/utils/stylesheet-loader'

describe('prepareStylesheet', () => {
    it('applies a preparer from a function or SDK config', () => {
        const prepare = (style: HTMLStyleElement) => {
            style.nonce = 'abc'
            return style
        }

        expect(prepareStylesheet(document, 'a{}', prepare)?.nonce).toBe('abc')
        expect(
            prepareStylesheet(document, 'a{}', { config: { prepare_external_dependency_stylesheet: prepare } })?.nonce
        ).toBe('abc')
    })

    it('returns null when the preparer returns null or throws', () => {
        expect(prepareStylesheet(document, 'a{}', () => null)).toBeNull()
        expect(
            prepareStylesheet(document, 'a{}', () => {
                throw new Error('customer failure')
            })
        ).toBeNull()
    })
})
