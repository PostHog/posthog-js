import { buildSourcemapCliArgs } from './cli'
import { ResolvedPluginConfig } from './config'

const config = (noReleaseBind: boolean): ResolvedPluginConfig => ({
    personalApiKey: 'phx_test',
    projectId: '1',
    host: 'https://us.i.posthog.com',
    logLevel: 'info',
    cliBinaryPath: '/tmp/posthog-cli',
    sourcemaps: {
        enabled: true,
        deleteAfterUpload: false,
        noReleaseBind,
    },
})

describe('buildSourcemapCliArgs', () => {
    it.each([
        { noReleaseBind: true, expected: ['sourcemap', 'process', '--stdin', '--no-release-bind'] },
        { noReleaseBind: false, expected: ['sourcemap', 'process', '--stdin'] },
    ])('passes --no-release-bind through only when enabled ($noReleaseBind)', ({ noReleaseBind, expected }) => {
        expect(buildSourcemapCliArgs(config(noReleaseBind), { stdin: true })).toEqual(expected)
    })
})
