import packageInfo from '../../package.json'

// Hooks are the newest React APIs used by this entrypoint and were introduced in React 16.8.0.
const REACT_MINIMUM_VERSION = '>=16.8.0'

// Declared at the same floor as `react` so the types resolve on strict node_modules layouts.
// The emitted declarations import the `JSX` namespace, which `@types/react` only exports from
// 18.2.6, but declaring that range makes `npm install` fail with ERESOLVE on older React types.
const REACT_TYPES_MINIMUM_VERSION = '>=16.8.0'

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
