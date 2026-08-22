import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type webpack from 'webpack'
import { runSourcemapCli } from '@posthog/plugin-utils'
import { PosthogWebpackPlugin } from './index'
import type { ResolvedPluginConfig } from './config'

const mockLoggerError = jest.fn()

jest.mock(
    '@posthog/core',
    () => ({
        createLogger: () => ({ error: mockLoggerError }),
    }),
    { virtual: true }
)

jest.mock('@posthog/plugin-utils', () => ({
    runSourcemapCli: jest.fn().mockResolvedValue(undefined),
}))

const runSourcemapCliMock = runSourcemapCli as jest.MockedFunction<typeof runSourcemapCli>

const config: ResolvedPluginConfig = {
    personalApiKey: 'phx_test',
    projectId: '1',
    host: 'https://us.i.posthog.com',
    logLevel: 'info',
    cliBinaryPath: 'posthog-cli',
    sourcemaps: {
        enabled: true,
        deleteAfterUpload: true,
        releaseMode: 'symbol-set',
    },
}

type TestAsset = { name: string }
type TestChunk = { files: Set<string> }

function createCompilation(outputDirectory: string, chunks: TestChunk[], assets: TestAsset[]): webpack.Compilation {
    return {
        outputOptions: { path: outputDirectory },
        chunks: new Set(chunks),
        getAssets: () => assets,
    } as unknown as webpack.Compilation
}

async function exists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath)
        return true
    } catch {
        return false
    }
}

function createCompiler(version: string | undefined): {
    compiler: webpack.Compiler
    sourceMapDevToolPlugin: jest.Mock
} {
    const sourceMapDevToolPlugin = jest.fn().mockImplementation(() => ({ apply: jest.fn() }))
    const compiler = {
        webpack: { SourceMapDevToolPlugin: sourceMapDevToolPlugin, version },
        hooks: { done: { tapAsync: jest.fn() } },
    } as unknown as webpack.Compiler
    return { compiler, sourceMapDevToolPlugin }
}

describe('PosthogWebpackPlugin', () => {
    let outputDirectory: string

    beforeEach(async () => {
        runSourcemapCliMock.mockClear()
        mockLoggerError.mockClear()
        outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-webpack-plugin-'))
    })

    afterEach(async () => {
        jest.restoreAllMocks()
        await fs.rm(outputDirectory, { force: true, recursive: true })
    })

    it.each([
        {
            deleteAfterUpload: true,
            expectedExists: false,
            label: 'deletes emitted CSS source maps after upload when deleteAfterUpload is enabled',
        },
        {
            deleteAfterUpload: false,
            expectedExists: true,
            label: 'keeps emitted CSS source maps after upload when deleteAfterUpload is disabled',
        },
    ])('$label', async ({ deleteAfterUpload, expectedExists }) => {
        const cssSourceMap = path.join(outputDirectory, 'static/css/app.css.map')
        await fs.mkdir(path.dirname(cssSourceMap), { recursive: true })
        await fs.writeFile(cssSourceMap, '{}')

        const testConfig = {
            ...config,
            sourcemaps: {
                ...config.sourcemaps,
                deleteAfterUpload,
            },
        }
        const plugin = new PosthogWebpackPlugin(testConfig, true)
        const compilation = createCompilation(
            outputDirectory,
            [{ files: new Set(['static/chunks/app.js']) }],
            [{ name: 'static/css/app.css.map' }]
        )

        await plugin.processSourceMaps(compilation, testConfig)

        expect(await exists(cssSourceMap)).toBe(expectedExists)
    })

    it.each<{ releaseMode: 'event' | 'symbol-set'; version: string | undefined; expected: boolean; label: string }>([
        {
            releaseMode: 'event',
            version: '5.108.1',
            expected: true,
            label: 'enables webpack debug ids in event release mode on webpack >= 5.104',
        },
        {
            releaseMode: 'event',
            version: '6.0.0',
            expected: true,
            label: 'enables webpack debug ids in event release mode on webpack 6',
        },
        {
            releaseMode: 'event',
            version: '5.103.9',
            expected: false,
            label: 'skips debug ids on webpacks that mishandle them with hidden source maps',
        },
        {
            releaseMode: 'event',
            version: undefined,
            expected: false,
            label: 'skips debug ids when the compiler reports no webpack version',
        },
        {
            releaseMode: 'event',
            version: 'nightly',
            expected: false,
            label: 'skips debug ids when the webpack version is unparsable',
        },
        {
            releaseMode: 'symbol-set',
            version: '5.108.1',
            expected: false,
            label: 'does not enable debug ids in symbol-set release mode',
        },
    ])('$label', ({ releaseMode, version, expected }) => {
        const testConfig = {
            ...config,
            sourcemaps: { ...config.sourcemaps, releaseMode },
        }
        const { compiler, sourceMapDevToolPlugin } = createCompiler(version)

        new PosthogWebpackPlugin(testConfig, true).apply(compiler)

        expect(sourceMapDevToolPlugin).toHaveBeenCalledTimes(1)
        const options = sourceMapDevToolPlugin.mock.calls[0][0]
        if (expected) {
            expect(options.debugIds).toBe(true)
        } else {
            // Absent rather than false: webpacks predating the option reject unknown keys.
            expect(options).not.toHaveProperty('debugIds')
        }
    })

    it('continues deleting CSS source maps and logs each deletion failure', async () => {
        const originalRm = fs.rm.bind(fs)
        const failedCssSourceMap = path.join(outputDirectory, 'static/css/app.css.map')
        const deletedCssSourceMap = path.join(outputDirectory, 'static/css/vendor.css.map')
        await fs.mkdir(path.dirname(failedCssSourceMap), { recursive: true })
        await fs.writeFile(failedCssSourceMap, '{}')
        await fs.writeFile(deletedCssSourceMap, '{}')

        jest.spyOn(fs, 'rm').mockImplementation(async (filePath, options) => {
            if (filePath === failedCssSourceMap) {
                throw new Error('permission denied')
            }

            return originalRm(filePath, options)
        })

        const plugin = new PosthogWebpackPlugin(config, true)
        const compilation = createCompilation(
            outputDirectory,
            [{ files: new Set(['static/chunks/app.js']) }],
            [{ name: 'static/css/app.css.map' }, { name: 'static/css/vendor.css.map' }]
        )

        await plugin.processSourceMaps(compilation, config)

        expect(await exists(failedCssSourceMap)).toBe(true)
        expect(await exists(deletedCssSourceMap)).toBe(false)
        expect(mockLoggerError).toHaveBeenCalledWith(
            'PostHog sourcemaps uploaded, but failed to delete CSS source map:',
            failedCssSourceMap,
            'permission denied'
        )
    })
})
