import { buildSourcemapCliArgs } from './cli'
import { resolveConfig } from './config'

const config = resolveConfig({
    personalApiKey: 'phx_test',
    projectId: '1',
})

describe('buildSourcemapCliArgs', () => {
    it('defaults to `sourcemap process` with --delete-after', () => {
        const args = buildSourcemapCliArgs(config, { stdin: true })

        expect(args.slice(0, 3)).toEqual(['sourcemap', 'process', '--stdin'])
        expect(args).toContain('--delete-after')
    })

    it('never passes --delete-after to `sourcemap upload`', () => {
        const args = buildSourcemapCliArgs(config, { stdin: true }, 'upload')

        expect(args.slice(0, 3)).toEqual(['sourcemap', 'upload', '--stdin'])
        expect(args).not.toContain('--delete-after')
    })

    it('keeps release args on upload', () => {
        const withRelease = resolveConfig({
            personalApiKey: 'phx_test',
            projectId: '1',
            sourcemaps: { releaseName: 'my-app', releaseVersion: '1.2.3' },
        })
        const args = buildSourcemapCliArgs(withRelease, { directory: 'dist' }, 'upload')

        expect(args).toEqual(
            expect.arrayContaining(['--directory', 'dist', '--release-name', 'my-app', '--release-version', '1.2.3'])
        )
    })
})
