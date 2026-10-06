import * as bundles from '../extensions/extension-bundles'
import * as slimEntrypoint from '../entrypoints/extension-bundles.es'

describe('extension-bundles entrypoint', () => {
    it('exports no bundle that extension-bundles lacks', () => {
        expect(Object.keys(slimEntrypoint).sort()).toEqual(Object.keys(bundles).sort())
    })

    it.each(Object.keys(bundles))('exports %s as the same bundle', (name) => {
        expect((slimEntrypoint as Record<string, unknown>)[name]).toBe((bundles as Record<string, unknown>)[name])
    })
})
