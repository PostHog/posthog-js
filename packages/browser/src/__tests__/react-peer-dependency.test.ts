import packageInfo from '../../package.json'

const REACT_HOOKS_MINIMUM_VERSION = '>=16.8.0'

// `posthog-js/react` is bundled with `react` external, so strict node_modules layouts
// (pnpm/bun isolated) can only resolve it when React is declared as a peer here.
describe('React entrypoint dependency metadata', () => {
    it('declares React as an optional peer dependency at the Hooks minimum version', () => {
        expect(packageInfo.peerDependencies.react).toBe(REACT_HOOKS_MINIMUM_VERSION)
        expect(packageInfo.peerDependenciesMeta.react.optional).toBe(true)
    })

    it('declares React types as an optional peer dependency at the Hooks minimum version', () => {
        expect(packageInfo.peerDependencies['@types/react']).toBe(REACT_HOOKS_MINIMUM_VERSION)
        expect(packageInfo.peerDependenciesMeta['@types/react'].optional).toBe(true)
    })
})
