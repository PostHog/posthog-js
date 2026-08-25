import packageInfo from '../../package.json'

// `posthog-js/react` is bundled with `react` external, so strict node_modules layouts
// (pnpm/bun isolated) can only resolve it when React is declared as a peer here.
describe('React entrypoint dependency metadata', () => {
    it('declares React as an optional peer dependency', () => {
        expect(packageInfo.peerDependencies.react).toBeDefined()
        expect(packageInfo.peerDependenciesMeta.react.optional).toBe(true)
    })

    it('declares React types as an optional peer dependency', () => {
        expect(packageInfo.peerDependencies['@types/react']).toBeDefined()
        expect(packageInfo.peerDependenciesMeta['@types/react'].optional).toBe(true)
    })
})
