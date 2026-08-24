import type { OutputOptions } from 'rollup'
import {
    createChunkIdComment,
    createChunkIdSnippet,
    determineChunkIdFromSource,
    resolveReleaseId,
    runSourcemapCli,
} from '@posthog/plugin-utils'
import posthogRollupPlugin from './index.js'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

jest.mock('@posthog/plugin-utils', () => ({
    ...jest.requireActual('@posthog/plugin-utils'),
    runSourcemapCli: jest.fn().mockResolvedValue(undefined),
    resolveReleaseId: jest.fn().mockResolvedValue('release-id-1'),
}))

const options = {
    personalApiKey: 'phx_test',
    projectId: '1',
}

type RenderChunkResult = { code: string; map: unknown } | null

type TestPlugin = {
    config: () => { build: { sourcemap: 'hidden' | true } } | undefined
    buildStart: () => void
    outputOptions: {
        handler: (options: OutputOptions) => OutputOptions
    }
    renderChunk: {
        order: 'post'
        handler: (code: string, chunk: { fileName: string }) => RenderChunkResult
    }
    generateBundle: {
        order: 'pre'
        handler: (options: OutputOptions, bundle: Record<string, unknown>) => void
    }
    writeBundle: {
        sequential: true
        handler: (options: OutputOptions, bundle: Record<string, unknown>) => Promise<void>
    }
}

const testPlugin = (...args: Parameters<typeof posthogRollupPlugin>): TestPlugin =>
    posthogRollupPlugin(...args) as unknown as TestPlugin

describe('posthogRollupPlugin', () => {
    it('enables hidden sourcemaps in Vite and Rollup when maps are deleted after upload', () => {
        const plugin = testPlugin(options)

        expect(plugin.config()).toEqual({ build: { sourcemap: 'hidden' } })
        expect(plugin.outputOptions.handler({} as OutputOptions)).toEqual({ sourcemap: 'hidden' })
    })

    it('enables visible sourcemaps when maps are kept after upload', () => {
        const plugin = testPlugin({
            ...options,
            sourcemaps: { deleteAfterUpload: false },
        })

        expect(plugin.config()).toEqual({ build: { sourcemap: true } })
        expect(plugin.outputOptions.handler({} as OutputOptions)).toEqual({ sourcemap: true })
    })

    it('leaves sourcemap settings alone when disabled', () => {
        const plugin = testPlugin({
            personalApiKey: '',
            sourcemaps: { enabled: false },
        })
        const outputOptions = { sourcemap: false } as OutputOptions

        expect(plugin.config()).toBeUndefined()
        expect(plugin.outputOptions.handler(outputOptions)).toBe(outputOptions)
    })

    describe('renderChunk', () => {
        const code = 'console.log("chunk one");console.log("chunk two");'

        it('injects the chunk id snippet and trailing comment in-memory', () => {
            const plugin = testPlugin(options)
            const result = plugin.renderChunk.handler(code, { fileName: 'index-abc123.js' })

            expect(result).not.toBeNull()
            expect(result!.code.startsWith('!function(){try{var e=')).toBe(true)
            expect(result!.code).toContain(code)
            expect(result!.code).toMatch(/\n\/\/# chunkId=[0-9a-f-]{36}$/)
            expect(result!.map).toBeDefined()

            // the runtime snippet and the CLI-facing comment carry the same id
            const commentId = result!.code.match(/\/\/# chunkId=(\S+)$/)![1]
            expect(determineChunkIdFromSource(result!.code)).toBe(commentId)
        })

        it('mints a fresh chunk id per injection', () => {
            const plugin = testPlugin(options)
            const first = plugin.renderChunk.handler(code, { fileName: 'a.js' })
            const second = plugin.renderChunk.handler(code, { fileName: 'b.js' })

            expect(determineChunkIdFromSource(first!.code)).not.toBe(determineChunkIdFromSource(second!.code))
        })

        it('does not re-inject already injected code', () => {
            const plugin = testPlugin(options)
            const injected = plugin.renderChunk.handler(code, { fileName: 'index.js' })!.code

            expect(plugin.renderChunk.handler(injected, { fileName: 'index.js' })).toBeNull()
        })

        it('keeps a "use strict" directive in effect by injecting after it', () => {
            const plugin = testPlugin(options)
            const result = plugin.renderChunk.handler('"use strict";console.log("app");', {
                fileName: 'index.cjs',
            })

            expect(result!.code.startsWith('"use strict";!function(){try{')).toBe(true)
        })

        it('does not split a leading string-literal expression', () => {
            const plugin = testPlugin(options)
            const cases = [
                '"undefined"!=typeof window&&console.log(1);',
                '"undefined"\n!=typeof window&&console.log(1);',
                '"a"\n.charCodeAt(0);',
                '"a"\n+"b";',
            ]

            for (const minified of cases) {
                const result = plugin.renderChunk.handler(minified, { fileName: 'index.js' })

                expect(result!.code.startsWith('!function(){try{')).toBe(true)
                expect(result!.code).toContain(minified)
                expect(() => new Function(result!.code)).not.toThrow()
            }
        })

        it('honors semicolonless ASI directives', () => {
            const plugin = testPlugin(options)
            const result = plugin.renderChunk.handler('"use strict"\n!function(){console.log(1)}();', {
                fileName: 'index.js',
            })

            expect(result!.code.startsWith('"use strict"\n!function(){try{')).toBe(true)
            expect(() => new Function(result!.code)).not.toThrow()
        })

        it('injects after a full directive prologue like "use client"', () => {
            const plugin = testPlugin(options)
            const result = plugin.renderChunk.handler('"use client";\n"use strict";\nconsole.log("app");', {
                fileName: 'index.js',
            })

            expect(result!.code.startsWith('"use client";\n"use strict";\n!function(){try{')).toBe(true)
        })

        describe('event release mode', () => {
            const eventOptions = { ...options, sourcemaps: { releaseMode: 'event' as const } }

            beforeEach(() => {
                jest.mocked(resolveReleaseId).mockResolvedValue('release-id-1')
            })

            it('injects the resolved release id so exceptions carry it', async () => {
                const plugin = testPlugin(eventOptions)

                const result = await plugin.renderChunk.handler(code, { fileName: 'index.js' })

                expect(result!.code).toContain('e._posthogReleaseId=e._posthogReleaseId||"release-id-1"')
            })

            it('derives the chunk id from content, so rebuilds reuse the symbol set', async () => {
                const plugin = testPlugin(eventOptions)

                const first = await plugin.renderChunk.handler(code, { fileName: 'index.js' })
                const rebuilt = await testPlugin(eventOptions).renderChunk.handler(code, { fileName: 'index.js' })
                const other = await plugin.renderChunk.handler(`${code}more();`, { fileName: 'other.js' })

                expect(determineChunkIdFromSource(rebuilt!.code)).toBe(determineChunkIdFromSource(first!.code))
                expect(determineChunkIdFromSource(other!.code)).not.toBe(determineChunkIdFromSource(first!.code))
            })

            it('resolves the release once per build, not once per chunk', async () => {
                const plugin = testPlugin(eventOptions)

                await plugin.renderChunk.handler(code, { fileName: 'a.js' })
                await plugin.renderChunk.handler(`${code}more();`, { fileName: 'b.js' })

                expect(resolveReleaseId).toHaveBeenCalledTimes(1)

                // A watch-mode rebuild can land on a new commit, so the next build resolves again.
                plugin.buildStart()
                await plugin.renderChunk.handler(code, { fileName: 'a.js' })

                expect(resolveReleaseId).toHaveBeenCalledTimes(2)
            })

            it('still injects chunk ids when no release can be resolved', async () => {
                // Chunk ids alone still symbolicate, so a build with no identifiable release warns
                // instead of failing, the way posthog-cli does.
                jest.mocked(resolveReleaseId).mockResolvedValue(undefined)
                const plugin = testPlugin(eventOptions)
                const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

                const result = await plugin.renderChunk.handler(code, { fileName: 'index.js' })

                expect(result!.code).not.toContain('_posthogReleaseId')
                expect(determineChunkIdFromSource(result!.code)).toBeDefined()
                expect(warn).toHaveBeenCalledWith(expect.stringContaining('no release could be resolved'))
                warn.mockRestore()
            })

            it('does not resolve a release in symbol-set mode', async () => {
                const plugin = testPlugin(options)

                await plugin.renderChunk.handler(code, { fileName: 'index.js' })

                expect(resolveReleaseId).not.toHaveBeenCalled()
            })
        })

        it('skips non-js chunks and disabled sourcemaps', () => {
            const plugin = testPlugin(options)
            const disabled = testPlugin({ personalApiKey: '', sourcemaps: { enabled: false } })

            expect(plugin.renderChunk.handler(code, { fileName: 'style.css' })).toBeNull()
            expect(disabled.renderChunk.handler(code, { fileName: 'index.js' })).toBeNull()
        })
    })

    describe('generateBundle', () => {
        const code = 'console.log("app");'
        const preliminaryFileName = 'index-!~{001}~.js'
        const fileName = 'index-abc123.js'

        it('restores a chunk id comment removed after renderChunk', () => {
            const plugin = testPlugin(options)
            const rendered = plugin.renderChunk.handler(code, { fileName: preliminaryFileName })!
            const chunkId = determineChunkIdFromSource(rendered.code)!
            const minifiedCode = rendered.code.replace(createChunkIdComment(chunkId), '')
            const bundle = {
                [fileName]: { type: 'chunk', fileName, preliminaryFileName, code: minifiedCode },
            }

            plugin.generateBundle.handler({} as OutputOptions, bundle)

            expect(determineChunkIdFromSource(bundle[fileName].code)).toBe(chunkId)
        })

        it('does not duplicate a chunk id comment that survived output minification', () => {
            const plugin = testPlugin(options)
            const rendered = plugin.renderChunk.handler(code, { fileName: preliminaryFileName })!
            const bundle = {
                [fileName]: { type: 'chunk', fileName, preliminaryFileName, code: rendered.code },
            }

            plugin.generateBundle.handler({} as OutputOptions, bundle)

            expect(bundle[fileName].code.match(/\/\/# chunkId=/g)).toHaveLength(1)
        })

        it('does not add a chunk id to prebuilt chunks that skipped renderChunk', () => {
            const plugin = testPlugin(options)
            const bundle = {
                [fileName]: { type: 'chunk', fileName, preliminaryFileName, code },
            }

            plugin.generateBundle.handler({} as OutputOptions, bundle)

            expect(determineChunkIdFromSource(bundle[fileName].code)).toBeUndefined()
        })
    })

    describe('writeBundle', () => {
        let dir: string

        beforeEach(async () => {
            dir = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-rollup-plugin-'))
            await fs.writeFile(path.join(dir, 'index.js'), 'console.log("app");')
            await fs.writeFile(path.join(dir, 'index.js.map'), '{}')
        })

        afterEach(async () => {
            await fs.rm(dir, { recursive: true, force: true })
        })

        const injectedCode = `${createChunkIdSnippet('test-chunk-id')}console.log("app");${createChunkIdComment('test-chunk-id')}`
        const bundle = {
            'index.js': { type: 'chunk', code: injectedCode, sourcemapFileName: 'index.js.map' },
            'index.css': { type: 'asset' },
        }

        it('uploads without mutating and deletes maps itself when deleteAfterUpload is on', async () => {
            const plugin = testPlugin(options)
            const before = await fs.readFile(path.join(dir, 'index.js'), 'utf8')

            await plugin.writeBundle.handler({ dir } as OutputOptions, bundle)

            expect(runSourcemapCli).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ command: 'upload', filePaths: [path.join(dir, 'index.js')] })
            )
            expect(await fs.readFile(path.join(dir, 'index.js'), 'utf8')).toBe(before)
            await expect(fs.access(path.join(dir, 'index.js.map'))).rejects.toThrow()
        })

        it('keeps maps when deleteAfterUpload is off', async () => {
            const plugin = testPlugin({ ...options, sourcemaps: { deleteAfterUpload: false } })

            await plugin.writeBundle.handler({ dir } as OutputOptions, bundle)

            await expect(fs.access(path.join(dir, 'index.js.map'))).resolves.toBeUndefined()
        })

        it('keeps maps when the upload fails', async () => {
            const plugin = testPlugin(options)
            jest.mocked(runSourcemapCli).mockRejectedValueOnce(new Error('upload failed'))

            await expect(plugin.writeBundle.handler({ dir } as OutputOptions, bundle)).rejects.toThrow('upload failed')

            await expect(fs.access(path.join(dir, 'index.js.map'))).resolves.toBeUndefined()
        })

        it('excludes chunks without a chunk id from the upload', async () => {
            const plugin = testPlugin(options)

            await plugin.writeBundle.handler({ dir } as OutputOptions, {
                ...bundle,
                'prebuilt.js': { type: 'chunk', code: 'console.log("prebuilt");' },
            })

            expect(runSourcemapCli).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ filePaths: [path.join(dir, 'index.js')] })
            )
        })

        it('does not fail the build when map cleanup fails after a successful upload', async () => {
            const plugin = testPlugin(options)
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
            const rm = jest.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('EPERM: operation not permitted'))

            await expect(plugin.writeBundle.handler({ dir } as OutputOptions, bundle)).resolves.toBeUndefined()

            expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to delete source map'))
            rm.mockRestore()
            warn.mockRestore()
        })

        it('fails fast when hidden maps use a custom sourcemapFileNames layout', async () => {
            const plugin = testPlugin(options)

            await expect(
                plugin.writeBundle.handler({ dir, sourcemap: 'hidden' } as OutputOptions, {
                    'index.js': { type: 'chunk', code: injectedCode, sourcemapFileName: 'maps/index.js.map' },
                })
            ).rejects.toThrow('custom output.sourcemapFileNames')

            expect(runSourcemapCli).not.toHaveBeenCalled()
        })

        it('keeps maps the CLI cannot discover under custom sourcemapFileNames', async () => {
            const plugin = testPlugin(options)
            await fs.mkdir(path.join(dir, 'maps'))
            await fs.writeFile(path.join(dir, 'maps', 'index.js.map'), '{}')

            await plugin.writeBundle.handler({ dir } as OutputOptions, {
                'index.js': { type: 'chunk', code: injectedCode, sourcemapFileName: 'maps/index.js.map' },
            })

            await expect(fs.access(path.join(dir, 'maps', 'index.js.map'))).resolves.toBeUndefined()
        })
    })
})
