import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { runSourcemapCli } from '@posthog/plugin-utils'
import { PosthogWebpackPlugin } from './index.js'

jest.mock('@posthog/plugin-utils', () => ({
    ...jest.requireActual('@posthog/plugin-utils'),
    runSourcemapCli: jest.fn().mockResolvedValue(undefined),
}))

const baseConfig = {
    personalApiKey: 'phx_test',
    projectId: '1',
    sourcemaps: {
        enabled: true,
        deleteAfterUpload: true,
    },
} as const

const createCompilation = (outputDirectory: string) =>
    ({
        outputOptions: { path: outputDirectory },
        chunks: [
            {
                files: new Set(['static/js/app.js', 'static/js/app.js.map']),
            },
        ],
        getAssets: () => [
            { name: 'static/css/app.css.map' },
            { name: 'static/js/app.js.map' },
            { name: 'static/css/app.css' },
        ],
    }) as any

describe('PosthogWebpackPlugin', () => {
    let outputDirectory: string

    beforeEach(async () => {
        outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-webpack-plugin-'))
        await fs.mkdir(path.join(outputDirectory, 'static/css'), { recursive: true })
        await fs.mkdir(path.join(outputDirectory, 'static/js'), { recursive: true })
        await fs.writeFile(path.join(outputDirectory, 'static/css/app.css.map'), '{}')
        await fs.writeFile(path.join(outputDirectory, 'static/js/app.js.map'), '{}')
    })

    afterEach(async () => {
        await fs.rm(outputDirectory, { recursive: true, force: true })
    })

    it('deletes emitted CSS sourcemaps after a successful upload when delete-after is enabled', async () => {
        const plugin = new PosthogWebpackPlugin(baseConfig)

        await plugin.processSourceMaps(createCompilation(outputDirectory), plugin.resolvedConfig)

        await expect(fs.stat(path.join(outputDirectory, 'static/css/app.css.map'))).rejects.toMatchObject({
            code: 'ENOENT',
        })
        await expect(fs.stat(path.join(outputDirectory, 'static/js/app.js.map'))).resolves.toBeDefined()
        expect(runSourcemapCli).toHaveBeenCalledWith(plugin.resolvedConfig, {
            filePaths: [
                path.join(outputDirectory, 'static/js/app.js'),
                path.join(outputDirectory, 'static/js/app.js.map'),
            ],
        })
    })

    it('keeps emitted CSS sourcemaps when delete-after is disabled', async () => {
        const plugin = new PosthogWebpackPlugin({
            ...baseConfig,
            sourcemaps: { ...baseConfig.sourcemaps, deleteAfterUpload: false },
        })

        await plugin.processSourceMaps(createCompilation(outputDirectory), plugin.resolvedConfig)

        await expect(fs.stat(path.join(outputDirectory, 'static/css/app.css.map'))).resolves.toBeDefined()
    })
})
