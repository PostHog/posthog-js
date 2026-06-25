import fs from 'fs'
import path from 'path'

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))

describe('package metadata', () => {
    it('declares react as an optional peer for the legacy posthog-js/react entrypoint', () => {
        expect(packageJson.files).toEqual(expect.arrayContaining(['react/dist/**', 'react/package.json']))
        expect(packageJson.peerDependencies).toEqual(expect.objectContaining({ react: '>=16.8.0' }))
        expect(packageJson.peerDependenciesMeta).toEqual(
            expect.objectContaining({ react: expect.objectContaining({ optional: true }) })
        )
        expect(packageJson.dependencies?.react).toBeUndefined()
    })
})
