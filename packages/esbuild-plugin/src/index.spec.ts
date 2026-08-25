import { build } from 'esbuild'
import type { OutputFile, Plugin } from 'esbuild'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import posthogEsbuildPlugin from './index'

const decoder = new TextDecoder()
const input = '"use strict";\nexport function fail() {\n  throw new Error("boom")\n}\n'

async function buildFixture(options: { plugins?: Plugin[]; sourcemap?: boolean | 'external' } = {}) {
    const outdir = path.join(os.tmpdir(), `posthog-esbuild-plugin-${Math.random().toString(16).slice(2)}`)
    const result = await build({
        stdin: {
            contents: input,
            sourcefile: 'src/app.ts',
            loader: 'ts',
        },
        bundle: true,
        format: 'esm',
        outfile: path.join(outdir, 'app.js'),
        sourcemap: options.sourcemap ?? 'external',
        write: false,
        plugins: options.plugins ?? [posthogEsbuildPlugin()],
    })

    const javascript = result.outputFiles.find((file) => file.path.endsWith('app.js'))
    const sourceMap = result.outputFiles.find((file) => file.path.endsWith('app.js.map'))
    return { result, javascript, sourceMap, outdir }
}

async function buildContentHashed(plugins: Plugin[]) {
    const outdir = path.join(os.tmpdir(), `posthog-esbuild-hash-${Math.random().toString(16).slice(2)}`)
    return build({
        stdin: {
            contents: input,
            sourcefile: 'app.ts',
            loader: 'ts',
        },
        bundle: true,
        format: 'esm',
        outdir,
        entryNames: '[name]-[hash]',
        sourcemap: 'external',
        write: false,
        plugins,
    })
}

function text(file: OutputFile | undefined): string {
    if (!file) {
        throw new Error('expected output file')
    }
    return decoder.decode(file.contents)
}

function generatedPosition(source: string, needle: string): { line: number; column: number } {
    const offset = source.indexOf(needle)
    if (offset === -1) {
        throw new Error(`missing ${needle}`)
    }
    const before = source.slice(0, offset)
    const lines = before.split('\n')
    return { line: lines.length, column: lines.at(-1)!.length }
}

describe('posthogEsbuildPlugin', () => {
    it('registers the output filename and stamps the same id into the sourcemap', async () => {
        const { javascript, sourceMap, outdir } = await buildFixture()
        const source = text(javascript)
        const map = JSON.parse(text(sourceMap))

        expect(source).toContain('_posthogChunkIds')
        expect(source).toContain('/* posthog-chunk-id: output-filename */')
        expect(source).not.toContain('//# chunkId=')
        expect(map.chunk_id).toBe('app.js')

        await mkdir(outdir, { recursive: true })
        await writeFile(path.join(outdir, 'package.json'), '{"type":"module"}')
        await writeFile(
            path.join(outdir, 'app.js'),
            `${source}\nconsole.log(JSON.stringify(globalThis._posthogChunkIds))`
        )
        const runtimeChunkIds = JSON.parse(
            execFileSync(process.execPath, [path.join(outdir, 'app.js')], { encoding: 'utf8' })
        )

        expect(Object.values(runtimeChunkIds)).toContain('app.js')
    })

    it('preserves original TypeScript positions because esbuild maps the banner itself', async () => {
        const { javascript, sourceMap } = await buildFixture()
        const source = text(javascript)
        const map = new TraceMap(text(sourceMap))
        const generated = generatedPosition(source, 'throw new Error')
        const original = originalPositionFor(map, generated)

        expect(original.source).toContain('src/app.ts')
        expect(original.line).toBe(3)
        expect(original.column).toBe(2)
    })

    it('is included before esbuild computes output filenames and downstream hashes', async () => {
        let hashSeenByLaterPlugin: string | undefined
        const hashPlugin: Plugin = {
            name: 'hash-final-output',
            setup(build) {
                build.onEnd((result) => {
                    const output = result.outputFiles?.find((file) => file.path.endsWith('.js'))
                    if (output) {
                        hashSeenByLaterPlugin = createHash('sha1').update(output.contents).digest('hex')
                    }
                })
            },
        }

        const withPlugin = await buildContentHashed([posthogEsbuildPlugin(), hashPlugin])
        const repeated = await buildContentHashed([posthogEsbuildPlugin()])
        const withoutPlugin = await buildContentHashed([])
        const output = withPlugin.outputFiles.find((file) => file.path.endsWith('.js'))!
        const repeatedOutput = repeated.outputFiles.find((file) => file.path.endsWith('.js'))!
        const plainOutput = withoutPlugin.outputFiles.find((file) => file.path.endsWith('.js'))!

        expect(hashSeenByLaterPlugin).toBe(createHash('sha1').update(output.contents).digest('hex'))
        expect(path.basename(output.path)).toBe(path.basename(repeatedOutput.path))
        expect(output.contents).toEqual(repeatedOutput.contents)
        expect(path.basename(output.path)).not.toBe(path.basename(plainOutput.path))
        expect(JSON.parse(text(withPlugin.outputFiles.find((file) => file.path.endsWith('.map')))).chunk_id).toBe(
            path.basename(output.path)
        )
    })

    it('does not add the banner twice when configured twice', async () => {
        const { javascript } = await buildFixture({
            plugins: [posthogEsbuildPlugin(), posthogEsbuildPlugin()],
        })

        expect(text(javascript).match(/_posthogChunkIds/g)).toHaveLength(3)
    })

    it('fails with an actionable error when JavaScript source maps are disabled', async () => {
        await expect(buildFixture({ sourcemap: false })).rejects.toThrow('Enable JavaScript source maps')
    })

    it('can be disabled for non-production Angular configurations', async () => {
        const { javascript, sourceMap } = await buildFixture({
            plugins: [posthogEsbuildPlugin({ enabled: false })],
        })

        expect(text(javascript)).not.toContain('_posthogChunkIds')
        expect(JSON.parse(text(sourceMap))).not.toHaveProperty('chunk_id')
    })
})
