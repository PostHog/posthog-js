import { argv, stdout } from 'node:process'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { analyzeMetafile, build } from 'esbuild'

const COMPLIANT_BASELINE_PENDING = 'Set binding budgets after P0 compliance and the optimization pass.'
const forbiddenInputs = [
    /(^|\/)packages\/browser\/(src|dist)\//,
    /(^|\/)\.\.\/browser\/(src|dist)\//,
    /(^|\/)packages\/core\/(src|dist)\//,
    /(^|\/)\.\.\/core\/(src|dist)\//,
    /(^|\/)packages\/rrweb\//,
    /(^|\/)\.\.\/rrweb\//,
    /(^|\/)node_modules\/(posthog-js|@posthog\/core|core-js|dompurify|fflate|preact|rrweb|web-vitals)\//,
]

const result = await build({
    entryPoints: ['fixtures/minimal.ts'],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    metafile: true,
    define: {
        __POSTHOG_BROWSER_VERSION__: JSON.stringify('0.0.0'),
        __BROWSER_COMMON_VERSION__: JSON.stringify('0.1.0'),
    },
})

const output = result.outputFiles[0]?.contents
if (!output) {
    throw new Error('The bundle-size fixture did not produce JavaScript')
}

const gzip = gzipSync(output, { level: 9 }).byteLength
const brotli = brotliCompressSync(output, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).byteLength
const inputs = Object.keys(result.metafile.inputs)
const forbidden = inputs.filter((input) => forbiddenInputs.some((pattern) => pattern.test(input)))

const attribution = Object.entries(result.metafile.outputs)
    .flatMap(([, details]) => Object.entries(details.inputs))
    .map(([input, details]) => ({ input, bytes: details.bytesInOutput }))
    .sort((a, b) => b.bytes - a.bytes)

stdout.write(`@posthog/browser minimal: ${output.byteLength} B minified, ${gzip} B gzip, ${brotli} B brotli\n`)
stdout.write(`Budget status: ${COMPLIANT_BASELINE_PENDING}\n`)
stdout.write('Module attribution (minified bytes):\n')
for (const { input, bytes } of attribution) {
    stdout.write(`${String(bytes).padStart(6)} B  ${input}\n`)
}

if (argv.includes('--analyze')) {
    stdout.write(`\n${await analyzeMetafile(result.metafile, { color: stdout.isTTY, verbose: true })}`)
}

if (forbidden.length > 0) {
    throw new Error(`The minimal bundle includes forbidden modules:\n${forbidden.join('\n')}`)
}
