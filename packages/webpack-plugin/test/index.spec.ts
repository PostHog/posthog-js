import path from 'path'
import type webpack from 'webpack'
import { runSourcemapCli } from '@posthog/plugin-utils'
import { PosthogWebpackPlugin } from '../src/index'
import type { ResolvedPluginConfig } from '../src/config'

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
        getAsset: (name: string) => assets.find((asset) => asset.name === name),
    } as unknown as webpack.Compilation
}

describe('PosthogWebpackPlugin', () => {
    beforeEach(() => {
        runSourcemapCliMock.mockClear()
    })

    it('passes emitted CSS assets with adjacent source maps to the sourcemap CLI', async () => {
        const outputDirectory = path.resolve('/tmp/posthog-webpack-plugin')
        const plugin = new PosthogWebpackPlugin(config, true)
        const compilation = createCompilation(
            outputDirectory,
            [
                {
                    files: new Set(['static/chunks/app.js', 'static/chunks/app.js.map']),
                },
            ],
            [
                { name: 'static/css/app.css' },
                { name: 'static/css/app.css.map' },
                { name: 'static/css/no-map.css' },
            ]
        )

        await plugin.processSourceMaps(compilation, config)

        expect(runSourcemapCliMock).toHaveBeenCalledWith(config, {
            filePaths: [
                path.resolve(outputDirectory, 'static/chunks/app.js'),
                path.resolve(outputDirectory, 'static/chunks/app.js.map'),
                path.resolve(outputDirectory, 'static/css/app.css'),
                path.resolve(outputDirectory, 'static/css/app.css.map'),
            ],
        })
    })
})
