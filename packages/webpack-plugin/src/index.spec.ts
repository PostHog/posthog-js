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
