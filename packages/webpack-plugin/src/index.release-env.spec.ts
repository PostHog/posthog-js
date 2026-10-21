import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
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

async function compile(config: webpack.Configuration) {
    const compiler = webpack(config)!
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
}

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
            globalThis.releaseAtStartup = globalThis.readExternalReleaseId();
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
        releaseId: string | undefined,
        nativeDebugIds: boolean,
        deleteAfterUpload: boolean,
        framework = true
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
        await compile({
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
                new webpack.DefinePlugin({
                    'process.env.POSTHOG_RELEASE_ID': JSON.stringify(releaseId) ?? 'undefined',
                }),
                {
                    apply(compiler) {
                        if (!nativeDebugIds) {
                            // Exercise the fallback used by Next 14's webpack 5.90.
                            compiler.webpack = Object.create(compiler.webpack, { version: { value: '5.90.0' } })
                        }
                    },
                },
                new PosthogWebpackPlugin(config, true, framework ? { mode: 'runtime', releaseId } : undefined),
            ],
        })
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

    function execute(javascript: Map<string, string>, hasProcess = true, initialReleaseId?: string) {
        const context = vm.createContext({ setTimeout, clearTimeout })
        if (hasProcess) context.process = { env: {} }
        // Like a CDN SDK, this reader never passes through webpack/DefinePlugin. Load it
        // before the runtime so the entry can verify the global is available at startup.
        vm.runInContext(`globalThis.readExternalReleaseId = ${ErrorTracking.getInjectedReleaseId.toString()};`, context)
        expect(context.readExternalReleaseId()).toBeUndefined()
        if (initialReleaseId !== undefined) {
            Object.defineProperty(context, '_posthogReleaseId', {
                get: () => initialReleaseId,
                set: () => {
                    throw new Error('The host blocks global assignment')
                },
            })
        }
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
        const runtimeFile = [...first.javascript.keys()].find((file) => file.startsWith('webpack-'))!
        expect(second.javascript.has(runtimeFile)).toBe(false)
        const lazyFile = [...first.javascript.keys()].find((file) => file.startsWith('lazy.'))!
        expect(second.javascript.get(lazyFile)).toBe(first.javascript.get(lazyFile))
        expect(second.uploadedMaps.get(lazyFile).chunk_id).toBe(first.uploadedMaps.get(lazyFile).chunk_id)
        expect(resolveReleaseId).not.toHaveBeenCalled()

        for (const [buildResult, release] of [
            [first, 'release-one'],
            [second, 'release-two'],
        ] as const) {
            for (const hasProcess of [true, false]) {
                const context = execute(buildResult.javascript, hasProcess)
                expect(context.readReleaseId()).toBe(release)
                expect(context.readExternalReleaseId()).toBe(release)
                expect(context.releaseAtStartup).toBe(release)
                expect(context._posthogReleaseId).toBe(release)
                expect((await context.loadLazy()).default).toBe('unchanged lazy module')
                expect(Object.values(context._posthogChunkIds)).toEqual(
                    expect.arrayContaining([...buildResult.uploadedMaps.values()].map((map) => map.chunk_id))
                )
            }
        }
    })

    it.each(['server-release', undefined])(
        'preserves the resolved release for an externalized server SDK (release=%s)',
        async (releaseId) => {
            // The real SDK reader stays outside webpack, so DefinePlugin cannot rewrite it.
            const externalSdk = createRequire(import.meta.url).resolve('@posthog/core/error-tracking')
            await fs.writeFile(
                path.join(directory, 'server.js'),
                `const sdk = require('external-sdk');
                module.exports = {
                    bundledReleaseId: process.env.POSTHOG_RELEASE_ID ?? null,
                    externalReleaseId: sdk.getInjectedReleaseId() ?? null
                };`
            )
            vi.mocked(resolveReleaseId).mockResolvedValue('must-not-resolve-another-release')
            vi.mocked(runSourcemapCli).mockResolvedValue(undefined)
            const outputPath = path.join(directory, 'server-dist')
            await compile({
                mode: 'production',
                target: 'node',
                context: directory,
                entry: './server.js',
                devtool: false,
                output: { path: outputPath, filename: 'server.cjs', library: { type: 'commonjs2' } },
                externals: { 'external-sdk': `commonjs ${externalSdk}` },
                plugins: [
                    new webpack.DefinePlugin({
                        'process.env.POSTHOG_RELEASE_ID': JSON.stringify(releaseId) ?? 'undefined',
                    }),
                    new PosthogWebpackPlugin(
                        resolveConfig({
                            personalApiKey: 'dummy',
                            projectId: '1',
                            cliBinaryPath: 'mock-cli',
                            sourcemaps: { releaseMode: 'event', deleteAfterUpload: true },
                        }),
                        true,
                        { mode: 'runtime', releaseId }
                    ),
                ],
            })
            // Start a separate deployment process without the build environment. Require the
            // external SDK before the bundle, as a server process may already have loaded it.
            const result = JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        '-e',
                        `const sdk = require(${JSON.stringify(externalSdk)});
                        const before = sdk.getInjectedReleaseId() ?? null;
                        const bundle = require(${JSON.stringify(path.join(outputPath, 'server.cjs'))});
                        console.log(JSON.stringify({ before, bundle,
                            environment: process.env.POSTHOG_RELEASE_ID ?? null,
                            after: sdk.getInjectedReleaseId() ?? null }));`,
                    ],
                    { encoding: 'utf8', env: { ...process.env, POSTHOG_RELEASE_ID: undefined } }
                )
            )
            expect(result).toEqual({
                before: null,
                bundle: { bundledReleaseId: releaseId ?? null, externalReleaseId: releaseId ?? null },
                environment: null,
                after: releaseId ?? null,
            })
            expect(resolveReleaseId).not.toHaveBeenCalled()
            expect(runSourcemapCli).toHaveBeenCalledTimes(1)
            expect(await fs.readdir(outputPath)).toEqual(['server.cjs'])
        }
    )

    it('omits runtime release metadata without resolving again when no release is available', async () => {
        const result = await build(undefined, true, true)
        const context = execute(result.javascript, false)
        expect(context.readExternalReleaseId()).toBeUndefined()
        expect(context._posthogReleaseId).toBeUndefined()
        expect(resolveReleaseId).not.toHaveBeenCalled()
    })

    it('escapes the runtime release literal and preserves an existing global', async () => {
        const releaseId = 'release-"\\\n'
        const result = await build(releaseId, true, true)
        expect(execute(result.javascript, false).readExternalReleaseId()).toBe(releaseId)
        expect(execute(result.javascript, false, 'existing-release').readExternalReleaseId()).toBe('existing-release')
    })

    it('does not break application startup when the host blocks release assignment', async () => {
        const result = await build('release', true, true)
        const context = execute(result.javascript, false, '')
        expect(context.readExternalReleaseId()).toBeUndefined()
        expect((await context.loadLazy()).default).toBe('unchanged lazy module')
    })

    it('does not change release injection for standalone webpack consumers', async () => {
        vi.mocked(resolveReleaseId).mockResolvedValue('legacy-release')
        const result = await build('compiled-release', false, true, false)
        expect(resolveReleaseId).toHaveBeenCalledTimes(1)
        expect(execute(result.javascript)._posthogReleaseId).toBe('legacy-release')
    })
})
