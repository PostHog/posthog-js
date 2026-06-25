import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type webpack from 'webpack'
import { runSourcemapCli } from '@posthog/plugin-utils'
import { PosthogWebpackPlugin } from './index'
import type { ResolvedPluginConfig } from './config'

jest.mock(
    '@posthog/core',
    () => ({
        createLogger: () => ({ error: jest.fn() }),
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
        outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-webpack-plugin-'))
    })

    afterEach(async () => {
        await fs.rm(outputDirectory, { force: true, recursive: true })
    })

    it('deletes emitted CSS source maps after upload when deleteAfterUpload is enabled', async () => {
        const cssSourceMap = path.join(outputDirectory, 'static/css/app.css.map')
        await fs.mkdir(path.dirname(cssSourceMap), { recursive: true })
        await fs.writeFile(cssSourceMap, '{}')

        const plugin = new PosthogWebpackPlugin(config, true)
        const compilation = createCompilation(
            outputDirectory,
            [{ files: new Set(['static/chunks/app.js']) }],
            [{ name: 'static/css/app.css.map' }]
        )

        await plugin.processSourceMaps(compilation, config)

        expect(await exists(cssSourceMap)).toBe(false)
    })

    it('keeps emitted CSS source maps after upload when deleteAfterUpload is disabled', async () => {
        const cssSourceMap = path.join(outputDirectory, 'static/css/app.css.map')
        await fs.mkdir(path.dirname(cssSourceMap), { recursive: true })
        await fs.writeFile(cssSourceMap, '{}')

        const keepSourceMapsConfig = {
            ...config,
            sourcemaps: {
                ...config.sourcemaps,
                deleteAfterUpload: false,
            },
        }
        const plugin = new PosthogWebpackPlugin(keepSourceMapsConfig, true)
        const compilation = createCompilation(
            outputDirectory,
            [{ files: new Set(['static/chunks/app.js']) }],
            [{ name: 'static/css/app.css.map' }]
        )

        await plugin.processSourceMaps(compilation, keepSourceMapsConfig)

        expect(await exists(cssSourceMap)).toBe(true)
    })
})
