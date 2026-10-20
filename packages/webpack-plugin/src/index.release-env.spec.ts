import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import webpack from 'webpack'
import { ErrorTracking } from '@posthog/core'
import { determineChunkIdFromSource, resolveReleaseId, runSourcemapCli } from '@posthog/plugin-utils'
import { PosthogWebpackPlugin, resolveConfig } from './index'

vi.mock('@posthog/plugin-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/plugin-utils')>()),
    resolveReleaseId: vi.fn(),
    runSourcemapCli: vi.fn().mockResolvedValue(undefined),
}))

describe('build-time releases with chunk-hashed webpack runtimes (#5332)', () => {
    let directory: string

    beforeEach(async () => {
        vi.mocked(resolveReleaseId).mockReset()
        vi.mocked(runSourcemapCli).mockClear()
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-webpack-release-env-'))
        // Exercise the real SDK release reader, with Next's build-time environment substitution.
        await fs.writeFile(
            path.join(directory, 'entry.js'),
            `
            globalThis.readReleaseId = ${ErrorTracking.getInjectedReleaseId.toString()};
            globalThis.loadLazy = () => import(/* webpackChunkName: "lazy" */ './lazy.js');
        `
        )
        await fs.writeFile(path.join(directory, 'lazy.js'), 'export default "unchanged lazy module";')
    })

    afterEach(async () => {
        await fs.rm(directory, { recursive: true, force: true })
    })

    async function build(
        releaseId: string,
        nativeDebugIds: boolean,
        deleteAfterUpload: boolean,
        injectReleaseId = false
    ) {
        const outputPath = path.join(directory, 'dist')
        // Separate clean deployments: webpack can skip writing an already-present immutable asset.
        await fs.rm(outputPath, { recursive: true, force: true })
        const config = resolveConfig({
            personalApiKey: 'dummy',
            projectId: '1',
            cliBinaryPath: 'mock-cli',
            sourcemaps: { releaseMode: 'event', deleteAfterUpload },
        })
        const uploadedMaps = new Map<string, any>()
        vi.mocked(runSourcemapCli).mockImplementation(async (_config, options) => {
            expect(options.command).toBe('upload')
            if (!('filePaths' in options)) throw new Error('Expected file paths')
            for (const file of options.filePaths) {
                const map = JSON.parse(await fs.readFile(`${file}.map`, 'utf8'))
                expect(map.chunk_id).toBe(determineChunkIdFromSource(await fs.readFile(file, 'utf8')))
                uploadedMaps.set(path.basename(file), map)
            }
        })
        const compiler = webpack({
            mode: 'production',
            context: directory,
            entry: './entry.js',
            devtool: false,
            // Next 14 app-router uses chunkhash for entry/runtime, contenthash for lazy chunks.
            output: {
                path: outputPath,
                filename: '[name]-[chunkhash].js',
                chunkFilename: '[name].[contenthash].js',
                publicPath: 'https://example.test/',
            },
            optimization: { minimize: true, runtimeChunk: { name: 'webpack' }, realContentHash: true },
            plugins: [
                new webpack.DefinePlugin({ 'process.env.POSTHOG_RELEASE_ID': JSON.stringify(releaseId) }),
                {
                    apply(compiler) {
                        if (!nativeDebugIds) {
                            // Exercise the fallback used by Next 14's webpack 5.90.
                            compiler.webpack = Object.create(compiler.webpack, { version: { value: '5.90.0' } })
                        }
                    },
                },
                new PosthogWebpackPlugin(config, true, { injectReleaseId }),
            ],
        })!
        try {
            await new Promise<void>((resolve, reject) =>
                compiler.run((error, stats) => {
                    if (error || stats?.hasErrors()) reject(error || new Error(stats?.toString()))
                    else resolve()
                })
            )
        } finally {
            await new Promise<void>((resolve, reject) => compiler.close((error) => (error ? reject(error) : resolve())))
        }
        const files = await fs.readdir(outputPath)
        const javascript = new Map(
            await Promise.all(
                files
                    .filter((file) => file.endsWith('.js'))
                    .map(async (file) => [file, await fs.readFile(path.join(outputPath, file), 'utf8')] as const)
            )
        )
        expect(files.some((file) => file.endsWith('.map'))).toBe(!deleteAfterUpload)
        expect(uploadedMaps.size).toBe(javascript.size)
        return { javascript, uploadedMaps }
    }

    function execute(javascript: Map<string, string>) {
        const context = vm.createContext({ process: { env: {} }, setTimeout, clearTimeout })
        context.self = context
        context.document = {
            getElementsByTagName: () => [],
            createElement: () => ({ setAttribute() {} }),
            head: {
                appendChild(script: { src: string; onload: (event: unknown) => void }) {
                    const filename = new URL(script.src).pathname.slice(1)
                    const code = javascript.get(filename)
                    if (!code) throw new Error(`Runtime requested missing chunk ${filename}`)
                    vm.runInContext(code, context, { filename })
                    script.onload({ type: 'load', target: script })
                },
            },
        }
        for (const prefix of ['webpack-', 'main-']) {
            const [filename, code] = [...javascript].find(([file]) => file.startsWith(prefix))!
            vm.runInContext(code, context, { filename })
        }
        return context
    }

    it.each([
        [false, false],
        [false, true],
        [true, false],
        [true, true],
    ])('keeps immutable URLs consistent (native=%s, delete=%s)', async (nativeDebugIds, deleteAfterUpload) => {
        const first = await build('release-one', nativeDebugIds, deleteAfterUpload)
        const second = await build('release-two', nativeDebugIds, deleteAfterUpload)
        const repeated = await build('release-two', nativeDebugIds, deleteAfterUpload)

        for (const [file, code] of first.javascript) {
            if (second.javascript.has(file)) expect(second.javascript.get(file)).toBe(code)
        }
        expect(repeated.javascript).toEqual(second.javascript)
        const lazyFile = [...first.javascript.keys()].find((file) => file.startsWith('lazy.'))!
        expect(second.javascript.get(lazyFile)).toBe(first.javascript.get(lazyFile))
        expect(second.uploadedMaps.get(lazyFile).chunk_id).toBe(first.uploadedMaps.get(lazyFile).chunk_id)
        expect(resolveReleaseId).not.toHaveBeenCalled()

        for (const [buildResult, release] of [
            [first, 'release-one'],
            [second, 'release-two'],
        ] as const) {
            const context = execute(buildResult.javascript)
            expect(context.readReleaseId()).toBe(release)
            expect(context._posthogReleaseId).toBeUndefined()
            expect((await context.loadLazy()).default).toBe('unchanged lazy module')
            expect(Object.values(context._posthogChunkIds)).toEqual(
                expect.arrayContaining([...buildResult.uploadedMaps.values()].map((map) => map.chunk_id))
            )
        }
    })

    it('does not change release injection for standalone webpack consumers', async () => {
        vi.mocked(resolveReleaseId).mockResolvedValue('legacy-release')
        const result = await build('compiled-release', false, true, true)
        expect(resolveReleaseId).toHaveBeenCalledTimes(1)
        expect(execute(result.javascript)._posthogReleaseId).toBe('legacy-release')
    })
})
