import { buildCliEnv, buildSourcemapCliArgs } from './cli'
import { resolveConfig } from './config'

const config = resolveConfig({
    personalApiKey: 'phx_test',
    projectId: '1',
})

describe('buildCliEnv', () => {
    const originalEnv = process.env.POSTHOG_RELEASE_MODE

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.POSTHOG_RELEASE_MODE
        } else {
            process.env.POSTHOG_RELEASE_MODE = originalEnv
        }
    })

    it('pins the release mode the plugin resolved, so an inherited value cannot flip the CLI', () => {
        // posthog-cli binds --release-mode to POSTHOG_RELEASE_MODE, so forwarding an inherited
        // 'event' would upload in event mode while the plugin injected symbol-set chunks, and the
        // build would end up with a release at neither end.
        process.env.POSTHOG_RELEASE_MODE = 'event'
        const symbolSet = resolveConfig({
            personalApiKey: 'phx_test',
            projectId: '1',
            sourcemaps: { releaseMode: 'symbol-set' },
        })

        expect(buildCliEnv(symbolSet).POSTHOG_RELEASE_MODE).toBe('symbol-set')
    })
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

    it.each([
        { releaseMode: 'symbol-set' as const, expected: false },
        { releaseMode: 'event' as const, expected: true },
    ])('passes --release-mode only in event mode ($releaseMode)', ({ releaseMode, expected }) => {
        // Symbol-set builds must stay compatible with a posthog-cli predating the flag, and an
        // event build that loses it binds its symbol sets to a release after all.
        const withMode = resolveConfig({
            personalApiKey: 'phx_test',
            projectId: '1',
            sourcemaps: { releaseMode },
        })

        const args = buildSourcemapCliArgs(withMode, { directory: 'dist' }, 'upload')

        expect(args.includes('--release-mode')).toBe(expected)
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
