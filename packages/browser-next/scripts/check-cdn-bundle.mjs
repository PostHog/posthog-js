import { stdout } from 'node:process'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const root = new URL('../', import.meta.url)
const stats = JSON.parse(await readFile(new URL('.playwright/cdn-stats.json', root), 'utf8'))
const initial = stats.chunks.filter((chunk) => chunk.initial)
assert.equal(initial.length, 1, 'The classic entry must embed its complete initial graph')
assert.deepEqual(initial[0].files, ['script.js'])
const modules = (entries) =>
    entries.flatMap((entry) => (entry.modules ? modules(entry.modules) : entry.name ? [entry] : []))
const initialModules = modules(initial[0].modules)
const requiredInitial = [
    './src/posthog.ts',
    './src/analytics.ts',
    './src/analytics-buffer.ts',
    './src/analytics-extension.ts',
    './src/capture-properties.ts',
    './src/analytics-delivery.ts',
    './src/capture-v1.ts',
    './src/lane.ts',
    './snippet/entry.ts',
]
const assertInitialModules = (entries) => {
    for (const required of requiredInitial) {
        assert(
            entries.some((module) => module.name === required),
            `Initial core must contain ${required}`
        )
    }
    for (const module of entries) {
        assert(
            !forbiddenInitial.some((pattern) => pattern.test(module.name)),
            `Forbidden initial module: ${module.name}`
        )
    }
}
const forbiddenInitial = [
    /\/(?:flags|feature-flags|logs|console-logs|surveys|surveys-extension|surveys-renderer|autocapture|rageclick)\.(?:ts|mjs|js)$/,
    /\/(?:core|browser)\/dist\//,
    /node_modules\/(?:posthog-js|@posthog\/core|core-js|fflate|preact|dompurify|rrweb|web-vitals)\//,
]
assertInitialModules(initialModules)
assert.throws(
    () => assertInitialModules(initialModules.filter((module) => module.name !== './src/analytics-delivery.ts')),
    /Initial core must contain/,
    'The CDN guard must require embedded analytics delivery'
)
assert.throws(
    () => assertInitialModules([...initialModules, { name: './src/logs.ts' }]),
    /Forbidden initial module/,
    'The CDN guard must reject eager optional product code'
)
const size = (buffers) => ({
    minified: buffers.reduce((sum, value) => sum + value.length, 0),
    gzip: buffers.reduce((sum, value) => sum + gzipSync(value, { level: 9 }).length, 0),
    brotli: buffers.reduce(
        (sum, value) => sum + brotliCompressSync(value, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
        0
    ),
})
const initialBuffers = []
const deferredBuffers = []
for (const chunk of stats.chunks) {
    for (const file of chunk.files) {
        const bytes = await readFile(new URL(`dist-cdn/${file}`, root))
        ;(chunk.initial ? initialBuffers : deferredBuffers).push(bytes)
        stdout.write(`${file}: ${JSON.stringify(size([bytes]))}` + '\n')
    }
    stdout.write(
        `Module attribution (${chunk.initial ? 'initial' : 'deferred'}, transformed bytes before minification):\n`
    )
    for (const module of modules(chunk.modules).sort((a, b) => b.size - a.size)) {
        stdout.write(`${String(module.size).padStart(7)} B ${module.name}` + '\n')
    }
}
assert(deferredBuffers.length > 0, 'Optional implementations must remain asynchronous chunks')
for (const [label, buffers] of [
    ['initial', initialBuffers],
    ['deferred', deferredBuffers],
    ['total', [...initialBuffers, ...deferredBuffers]],
]) {
    stdout.write(`CDN ${label}: ${JSON.stringify(size(buffers))}` + '\n')
}
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
assert(manifest.files.includes('dist'), 'npm output must retain its explicit dist allowlist')
assert(
    !manifest.files.some((file) => file === '.' || /snippet|cdn|\*/.test(file)),
    'CDN artifacts must stay outside the npm files graph'
)
stdout.write('CDN initial-module boundary and npm output isolation passed' + '\n')
