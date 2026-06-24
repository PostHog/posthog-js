const path = require('path')
const { runSourcemapCli } = require('@posthog/plugin-utils')

jest.mock('@posthog/plugin-utils', () => ({
    runSourcemapCli: jest.fn().mockResolvedValue(undefined),
}))

const { PosthogWebpackPlugin } = require('../dist/index.js')

const config = {
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

function createCompilation(outputDirectory, chunks, assets) {
    return {
        outputOptions: { path: outputDirectory },
        chunks: new Set(chunks),
        getAssets: () => assets,
        getAsset: (name) => assets.find((asset) => asset.name === name),
    }
}

describe('PosthogWebpackPlugin', () => {
    beforeEach(() => {
        runSourcemapCli.mockClear()
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

        expect(runSourcemapCli).toHaveBeenCalledWith(config, {
            filePaths: [
                path.resolve(outputDirectory, 'static/chunks/app.js'),
                path.resolve(outputDirectory, 'static/chunks/app.js.map'),
                path.resolve(outputDirectory, 'static/css/app.css'),
            ],
        })
    })
})
