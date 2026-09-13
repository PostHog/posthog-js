import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { SourceMap } from 'node:module'
import vm from 'node:vm'
import webpack from 'webpack'
import {
    createChunkIdSnippet,
    createChunkIdComment,
    determineChunkIdFromSource,
    resolveReleaseId,
    runSourcemapCli,
} from '@posthog/plugin-utils'
import { PosthogWebpackPlugin } from './index'

vi.mock('@posthog/plugin-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/plugin-utils')>()),
    runSourcemapCli: vi.fn(),
    resolveReleaseId: vi.fn().mockResolvedValue('release-one'),
}))

const hash = (code: string) => createHash('sha256').update(code).digest('base64')

describe('PosthogWebpackPlugin emitted integrity', () => {
    let directory: string
    let uploads: { file: string; code: string; map: any }[]

    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-webpack-integrity-'))
        uploads = []
        vi.mocked(resolveReleaseId).mockReset().mockResolvedValue('release-one')
        vi.mocked(runSourcemapCli).mockImplementation(async (_config, options) => {
            if (!('filePaths' in options)) throw new Error('Expected explicit upload inputs')
            for (const file of options.filePaths) {
                // Model the old CLI process command's post-emit byte mutation. Upload must be read-only.
                if (options.command !== 'upload') await fs.appendFile(file, '\n// post-emit CLI injection\n')
                uploads.push({
                    file,
                    code: await fs.readFile(file, 'utf8'),
                    map: JSON.parse(await fs.readFile(`${file}.map`, 'utf8')),
                })
            }
        })
    })

    afterEach(async () => {
        await fs.rm(directory, { recursive: true, force: true })
    })

    async function build(
        deleteAfterUpload: boolean,
        releaseMode: 'event' | 'symbol-set',
        extra: webpack.Configuration = {},
        runs = 1
    ) {
        await fs.writeFile(
            path.join(directory, 'entry.js'),
            '"use strict";\nmodule.exports = function boom() {\n  throw new Error("mapped failure");\n};\n'
        )
        // Supply a precise loader map for `new Error` (original line 3, column 9).
        // webpack's default OriginalSource map can be line-granular, which would
        // not detect a column shift introduced by the injected snippet.
        await fs.writeFile(
            path.join(directory, 'identity-map-loader.cjs'),
            `module.exports = function(source) {
                this.callback(null, source, {
                    version: 3, sources: [this.resourcePath], sourcesContent: [source],
                    names: [], mappings: ';;QAEQ'
                });
            };`
        )
        const hashes = new Map<string, string>()
        const compiler = webpack({
            mode: 'production',
            context: directory,
            entry: './entry.js',
            devtool: false,
            module: { rules: [{ test: /entry\.js$/, use: path.join(directory, 'identity-map-loader.cjs') }] },
            output: {
                path: path.join(directory, 'dist'),
                filename: '[name].[contenthash].js',
                library: { type: 'commonjs2' },
            },
            optimization: { minimize: false },
            ...extra,
            plugins: [
                ...(extra.plugins ?? []),
                new PosthogWebpackPlugin({
                    personalApiKey: 'dummy',
                    projectId: '1',
                    cliBinaryPath: 'mock-cli',
                    sourcemaps: { deleteAfterUpload, releaseMode },
                }),
                {
                    apply(compiler) {
                        compiler.hooks.compilation.tap('FixtureIntegrity', (compilation) => {
                            compilation.hooks.afterProcessAssets.tap('FixtureIntegrity', () => {
                                for (const asset of compilation.getAssets())
                                    if (/\.[mc]?js$/.test(asset.name))
                                        hashes.set(asset.name, hash(asset.source.source().toString()))
                            })
                        })
                    },
                },
            ],
        })!
        try {
            for (let i = 0; i < runs; i++) {
                await new Promise<void>((resolve, reject) =>
                    compiler.run((error, stats) => {
                        if (error || stats?.hasErrors()) reject(error || new Error(stats?.toString()))
                        else resolve()
                    })
                )
            }
        } finally {
            await new Promise<void>((resolve, reject) => compiler.close((error) => (error ? reject(error) : resolve())))
        }
        return hashes
    }

    function emitChunks(files: Record<string, { code: string; mapped: boolean }>): webpack.WebpackPluginInstance {
        return {
            apply(compiler) {
                compiler.hooks.compilation.tap('FixtureChunks', (compilation) => {
                    compilation.hooks.processAssets.tap(
                        { name: 'FixtureChunks', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING - 1 },
                        () => {
                            const chunk = [...compilation.chunks][0]
                            for (const [name, { code, mapped }] of Object.entries(files)) {
                                compilation.emitAsset(
                                    name,
                                    mapped
                                        ? new webpack.sources.OriginalSource(code, name)
                                        : new webpack.sources.RawSource(code)
                                )
                                chunk.files.add(name)
                            }
                        }
                    )
                })
            },
        }
    }

    it('keeps minified mappings correct after inserting the runtime snippet', async () => {
        const hashes = await build(false, 'event', { optimization: { minimize: true } })
        const { file, code, map } = uploads[0]
        expect(hash(code)).toBe(hashes.get(path.basename(file)))
        const context = vm.createContext({ module: {} })
        vm.runInContext('Error.prepareStackTrace = (_, frames) => frames', context)
        vm.runInContext(code, context, { filename: file })
        let frame: NodeJS.CallSite | undefined
        try {
            context.module.exports()
        } catch (error) {
            frame = (error as { stack: NodeJS.CallSite[] }).stack[0]
        }
        expect(frame).toBeTruthy()
        expect(new SourceMap(map).findEntry(frame!.getLineNumber()! - 1, frame!.getColumnNumber()! - 1)).toMatchObject({
            originalLine: 2,
            originalColumn: 8,
        })
    })

    it('preserves hashbangs, strict directives and existing chunk ids', async () => {
        const existing = `"use strict";\n${createChunkIdSnippet('existing-id')}\nmodule.exports = 1;${createChunkIdComment('existing-id')}`
        const prologue =
            '#!/usr/bin/env node\n"use strict";\nmodule.exports = (function() { return this })() === undefined;\n'
        const hashes = await build(false, 'symbol-set', {
            plugins: [
                emitChunks({
                    'existing.js': { code: existing, mapped: true },
                    'prologue.cjs': { code: prologue, mapped: true },
                }),
            ],
        })
        const existingUpload = uploads.find((u) => u.file.endsWith('/existing.js'))!
        expect(existingUpload.code.startsWith(existing)).toBe(true)
        expect(existingUpload.map.chunk_id).toBe('existing-id')
        expect(existingUpload.code.match(/\/\/# chunkId=/g)).toHaveLength(1)
        const injected = uploads.find((u) => u.file.endsWith('/prologue.cjs'))!
        expect(injected.code.startsWith('#!/usr/bin/env node\n"use strict";\n')).toBe(true)
        const context = vm.createContext({ module: {} })
        vm.runInContext(injected.code, context)
        expect(context.module.exports).toBe(true)
        expect(hash(injected.code)).toBe(hashes.get('prologue.cjs'))
    })

    it('does not mutate or upload unmapped, remote-map or inline-map chunks', async () => {
        const files = {
            'missing.js': { code: 'console.log(1);\n//# sourceMappingURL=missing.js.map', mapped: false },
            'remote.mjs': {
                code: 'console.log(2);\n//# sourceMappingURL=https://cdn.example.com/remote.map',
                mapped: false,
            },
            'inline.js': {
                code: 'console.log(3);\n//# sourceMappingURL=data:application/json;base64,e30=',
                mapped: false,
            },
        }
        await build(true, 'symbol-set', { plugins: [emitChunks(files)] })
        expect(uploads).toHaveLength(1)
        for (const [file, { code }] of Object.entries(files))
            expect(await fs.readFile(path.join(directory, 'dist', file), 'utf8')).toBe(code)
    })

    it('resolves each rebuild release while keeping native debug/chunk ids stable', async () => {
        vi.mocked(resolveReleaseId).mockResolvedValueOnce('release-one').mockResolvedValueOnce('release-two')
        await build(false, 'event', {}, 2)
        expect(uploads).toHaveLength(2)
        expect(resolveReleaseId).toHaveBeenCalledTimes(2)
        expect(uploads[0].map.chunk_id).toBe(uploads[1].map.chunk_id)
        expect(uploads[0].code).toContain('release-one')
        expect(uploads[1].code).toContain('release-two')
    })

    it('falls back to stable ids without native debug ids on older webpack', async () => {
        await build(
            false,
            'event',
            {
                plugins: [
                    {
                        apply(compiler) {
                            compiler.webpack = Object.create(compiler.webpack, { version: { value: '5.103.9' } })
                        },
                    },
                ],
            },
            2
        )
        expect(uploads).toHaveLength(2)
        expect(uploads[0].map.debugId).toBeUndefined()
        expect(uploads[0].map).toMatchObject({ version: 3, file: path.basename(uploads[0].file) })
        expect(uploads[0].map.sourcesContent).toContain(
            '"use strict";\nmodule.exports = function boom() {\n  throw new Error("mapped failure");\n};\n'
        )
        expect(uploads[0].map.chunk_id).toBe(uploads[1].map.chunk_id)
    })

    it('retains maps and skips upload when release resolution fails, then recovers on rebuild', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(resolveReleaseId).mockRejectedValueOnce(new Error('release unavailable'))
        await build(true, 'event', {}, 2)
        expect(error).toHaveBeenCalled()
        expect(uploads).toHaveLength(1)
        expect(uploads[0].map.chunk_id).toBeTruthy()
        // The failed compilation's map remains; only the successful rebuild's map is deleted.
        const files = await fs.readdir(path.join(directory, 'dist'))
        expect(files.filter((f) => f.endsWith('.map'))).toHaveLength(1)
        error.mockRestore()
    })

    it('retains all maps and emitted integrity on a mid-injection failure', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        let originalCode: string | undefined
        const hashes = await build(true, 'symbol-set', {
            plugins: [
                {
                    apply(compiler) {
                        compiler.hooks.compilation.tap('BrokenMap', (compilation) => {
                            compilation.hooks.processAssets.tap(
                                { name: 'BrokenMap', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING },
                                () => {
                                    const chunk = [...compilation.chunks][0]
                                    originalCode = 'module.exports = 42;'
                                    compilation.emitAsset('broken.js', new webpack.sources.RawSource(originalCode))
                                    compilation.emitAsset('broken.js.map', new webpack.sources.RawSource('invalid map'))
                                    chunk.files.add('broken.js')
                                }
                            )
                        })
                    },
                },
            ],
        })
        expect(error).toHaveBeenCalled()
        expect(uploads).toHaveLength(0)
        const files = await fs.readdir(path.join(directory, 'dist'))
        expect(files.filter((f) => f.endsWith('.map'))).toHaveLength(2)
        for (const file of files.filter((f) => f.endsWith('.js'))) {
            const code = await fs.readFile(path.join(directory, 'dist', file), 'utf8')
            expect(hash(code)).toBe(hashes.get(file))
            const context = vm.createContext({ module: {} })
            vm.runInContext(code, context)
            if (file === 'broken.js') expect(code).toBe(originalCode)
            else expect(context._posthogChunkIds).toBeTruthy()
        }
        error.mockRestore()
    })

    it.each([
        [true, 'symbol-set'],
        [false, 'symbol-set'],
        [true, 'event'],
        [false, 'event'],
    ] as const)(
        'preserves integrity, correlation and mapped lines (delete=%s, release=%s)',
        async (deleteAfterUpload, releaseMode) => {
            const hashes = await build(deleteAfterUpload, releaseMode)
            expect(uploads).toHaveLength(1)
            const { file, code, map } = uploads[0]
            expect(hash(await fs.readFile(file, 'utf8'))).toBe(hashes.get(path.basename(file)))
            expect(vi.mocked(runSourcemapCli).mock.lastCall?.[1]).toMatchObject({ command: 'upload' })
            const chunkId = determineChunkIdFromSource(code)
            expect(chunkId).toBeTruthy()
            expect(map.chunk_id).toBe(chunkId)
            expect(map).toMatchObject({ version: 3, file: path.basename(file) })
            if (releaseMode === 'event') {
                expect(map.debugId).toBe(chunkId)
                expect(resolveReleaseId).toHaveBeenCalledTimes(1)
            } else expect(resolveReleaseId).not.toHaveBeenCalled()

            const context = vm.createContext({ module: { exports: undefined } })
            // Avoid Vitest's automatic stack remapping: assert the emitted map against raw V8 positions.
            vm.runInContext('Error.prepareStackTrace = (_, frames) => frames', context)
            vm.runInContext(code, context, { filename: file })
            expect(Object.values(context._posthogChunkIds)).toContain(chunkId)
            expect(context._posthogReleaseId).toBe(releaseMode === 'event' ? 'release-one' : undefined)
            try {
                context.module.exports()
                throw new Error('Expected fixture to throw')
            } catch (error) {
                const frame = (error as { stack: NodeJS.CallSite[] }).stack[0]
                const mapped = new SourceMap(map).findEntry(frame.getLineNumber()! - 1, frame.getColumnNumber()! - 1)
                expect(mapped.originalSource).toContain('entry.js')
                expect(mapped.originalLine).toBe(2)
                expect(mapped.originalColumn).toBe(8)
            }
            if (deleteAfterUpload) await expect(fs.access(`${file}.map`)).rejects.toThrow()
            else expect(JSON.parse(await fs.readFile(`${file}.map`, 'utf8')).chunk_id).toBe(chunkId)
        }
    )
})
