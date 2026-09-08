// Diagnostic-only recorder. Never use its timings as production before/after evidence.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// oxlint-disable-next-line compat/compat -- Node CLI
const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.resolve(process.argv[2] || path.join(root, 'test-results/preprocessing-probe'))
assert(output !== path.join(root, 'dist'), 'Do not overwrite production artifacts')
const mutation = path.join(root, '../rrweb/rrweb/src/record/mutation.ts')
const record = path.join(root, '../rrweb/rrweb/src/record/index.ts')
const snapshotExports = [
    'wasMaxDepthReached',
    'resetMaxDepthState',
    'getLastSnapshotCost',
    'getMutationCost',
    'getDeferredStylesheetStats',
    'getDiscardedDurationSamples',
    'resetSnapshotCostState',
]
const source = `
import MutationBuffer from ${JSON.stringify(mutation)}
import './src/entrypoints/posthog-recorder'
const probe = globalThis.__rrwebMutationProbe = {
    reset() {
        this.stats = { genAddsCalls: 0, genAddsDistinct: 0, deepDeleteCalls: 0, deepDeleteVisits: 0, deepDeleteDistinct: 0, preprocessingMs: 0 }
        this.genSeen = new WeakSet()
        this.deepSeen = new WeakSet()
    },
    snapshot() { return { ...this.stats } }
}
probe.reset()
const wrappedSets = new WeakSet()
function instrumentSet(set, name) {
    if (wrappedSets.has(set)) return
    wrappedSets.add(set)
    for (const method of ['add', 'delete', 'has']) {
        const original = set[method]
        set[method] = function (...args) {
            const key = name + '.' + method
            probe.stats[key] = (probe.stats[key] || 0) + 1
            return original.apply(this, args)
        }
    }
}
const init = MutationBuffer.prototype.init
MutationBuffer.prototype.init = function (options) {
    init.call(this, options)
    const process = this.processMutations
    this.processMutations = function (...args) {
        instrumentSet(this.addedSet, 'addedSet')
        instrumentSet(this.movedSet, 'movedSet')
        return process.apply(this, args)
    }
    const gen = this.genAdds
    this.genAdds = function (node, target) {
        probe.stats.genAddsCalls++
        if (!probe.genSeen.has(node)) { probe.genSeen.add(node); probe.stats.genAddsDistinct++ }
        return gen.call(this, node, target)
    }
    const processMutation = this.processMutation
    this.processMutation = function (...args) {
        const start = performance.now()
        try { return processMutation.apply(this, args) }
        finally { probe.stats.preprocessingMs += performance.now() - start }
    }
}
`
const result = await build({
    stdin: { contents: source, resolveDir: root, sourcefile: 'preprocessing-probe.js' },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    sourcemap: true,
    outfile: path.join(output, 'posthog-recorder.js'),
    write: false,
    plugins: [
        {
            name: 'preprocessing-probe',
            setup(builder) {
                builder.onResolve({ filter: /\?worker&inline$/ }, (args) => ({
                    path: path.resolve(path.dirname(args.importer), args.path.split('?')[0]),
                    namespace: 'inline-worker',
                }))
                builder.onLoad({ filter: /.*/, namespace: 'inline-worker' }, async (args) => {
                    const worker = await build({
                        entryPoints: [args.path],
                        bundle: true,
                        write: false,
                        platform: 'browser',
                        format: 'iife',
                    })
                    return {
                        contents: `export default function InlineWorker(options) {
                        const url = URL.createObjectURL(new Blob([${JSON.stringify(worker.outputFiles[0].text)}], { type: 'text/javascript' }));
                        try { return new Worker(url, options) } finally { URL.revokeObjectURL(url) }
                    }`,
                    }
                })
                builder.onResolve({ filter: /^@posthog\/rrweb-record$/ }, () => ({
                    path: 'recorder',
                    namespace: 'probe',
                }))
                builder.onLoad({ filter: /.*/, namespace: 'probe' }, () => ({
                    contents: `export { default as record } from ${JSON.stringify(record)}; export { ${snapshotExports.join(', ')} } from '@posthog/rrweb-snapshot'`,
                    resolveDir: path.dirname(record),
                }))
                builder.onLoad({ filter: /[\\/]record[\\/]mutation\.ts$/ }, async (args) => {
                    assert.equal(args.path, mutation)
                    let contents = await readFile(mutation, 'utf8')
                    const declaration = 'function deepDelete(addsSet: Set<Node>, n: Node) {'
                    const visit = '    const next = stack.pop()!;'
                    assert.equal(contents.split(declaration).length, 2)
                    assert.equal(contents.split(visit).length, 2)
                    contents = contents.replace(
                        declaration,
                        declaration +
                            '\n  const probe = (globalThis as any).__rrwebMutationProbe; probe.stats.deepDeleteCalls++;'
                    )
                    contents = contents.replace(
                        visit,
                        visit +
                            '\n    probe.stats.deepDeleteVisits++; if (!probe.deepSeen.has(next)) { probe.deepSeen.add(next); probe.stats.deepDeleteDistinct++; }'
                    )
                    return { contents, loader: 'ts', resolveDir: path.dirname(mutation) }
                })
            },
        },
    ],
})
await mkdir(output, { recursive: true })
for (const file of result.outputFiles) await writeFile(file.path, file.contents)
// Both sides must use the same unmangled property names. Never pair this recorder
// with the production core, whose private properties have been mangled by Terser.
const core = await build({
    entryPoints: [path.join(root, 'src/entrypoints/array.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    write: false,
})
await writeFile(path.join(output, 'array.js'), core.outputFiles[0].contents)
await writeFile(
    path.join(output, 'mutation-probe.json'),
    JSON.stringify({
        diagnosticOnly: true,
        note: 'esbuild source recorder with invasive counters, not a production timing artifact',
    }) + '\n'
)
// oxlint-disable-next-line no-console -- CLI output
console.log(output)
