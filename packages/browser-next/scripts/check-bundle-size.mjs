import { stdout } from 'node:process'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const GZIP_LIMIT = 12 * 1024
const forbiddenInputs = [
    'packages/browser/src/',
    'packages/core/dist/',
    '../core/dist/',
    'packages/rrweb/',
    'node_modules/core-js/',
    'node_modules/dompurify/',
    'node_modules/fflate/',
    'node_modules/preact/',
    'node_modules/rrweb/',
    'node_modules/web-vitals/',
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
const forbidden = inputs.filter((input) => forbiddenInputs.some((fragment) => input.includes(fragment)))

stdout.write(`@posthog/browser minimal: ${output.byteLength} B minified, ${gzip} B gzip, ${brotli} B brotli\n`)

if (forbidden.length > 0) {
    throw new Error(`The minimal bundle includes forbidden modules:\n${forbidden.join('\n')}`)
}
if (gzip > GZIP_LIMIT) {
    throw new Error(`The minimal bundle is ${gzip} B gzip. The limit is ${GZIP_LIMIT} B.`)
}
