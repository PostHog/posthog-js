import { assignableWindow } from '../../utils/globals'

describe('customizations entrypoints', () => {
    beforeEach(() => {
        jest.resetModules()
        delete assignableWindow.posthogCustomizations
    })

    it('exports setAllPersonProfilePropertiesAsPersonPropertiesForFlags from the module entrypoint', async () => {
        // backs the `posthog-js/customizations` subpath — the importable alternative
        // to the internal `posthog-js/lib/src/customizations` path, which is CJS-only
        // and unresolvable under native ESM / Node16 module resolution
        const entry = await import('../../entrypoints/customizations.es')

        expect(typeof entry.setAllPersonProfilePropertiesAsPersonPropertiesForFlags).toBe('function')
    })

    it('publishes customizations on window.posthogCustomizations from the script entrypoint', async () => {
        await import('../../entrypoints/customizations.full')

        expect(
            typeof assignableWindow.posthogCustomizations?.setAllPersonProfilePropertiesAsPersonPropertiesForFlags
        ).toBe('function')
    })
})
