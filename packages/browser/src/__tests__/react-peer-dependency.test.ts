import packageInfo from '../../package.json'

// Hooks are the newest React APIs used by this entrypoint and were introduced in React 16.8.0.
const REACT_MINIMUM_VERSION = '>=16.8.0'

// The emitted declarations return `ReactElement`, whose props type parameter only gained
// its `any` default in @types/react 16.9.0.
const REACT_TYPES_MINIMUM_VERSION = '>=16.9.0'

// `posthog-js/react` is bundled with `react` external, so strict node_modules layouts
// (pnpm/bun isolated) can only resolve it when React is declared as a peer here.
describe('React entrypoint dependency metadata', () => {
    it('declares React as an optional peer dependency', () => {
        expect(packageInfo.peerDependencies.react).toBe(REACT_MINIMUM_VERSION)
        expect(packageInfo.peerDependenciesMeta.react.optional).toBe(true)
    })

    it('declares React types as an optional peer dependency', () => {
        expect(packageInfo.peerDependencies['@types/react']).toBe(REACT_TYPES_MINIMUM_VERSION)
        expect(packageInfo.peerDependenciesMeta['@types/react'].optional).toBe(true)
    })
})
