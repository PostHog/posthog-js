import packageInfo from '../../package.json'

describe('React entrypoint dependency metadata', () => {
    it('declares React as an optional peer dependency', () => {
        expect(packageInfo.peerDependencies.react).toBe('>=16.8.0')
        expect(packageInfo.peerDependenciesMeta.react.optional).toBe(true)
    })
})
