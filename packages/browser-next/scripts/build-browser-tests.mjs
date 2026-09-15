import { build } from 'esbuild'
import { rspack } from '@rspack/core'
import { fileURLToPath } from 'node:url'

await build({
    entryPoints: ['playwright/fixture.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile: '.playwright/fixture.js',
})

// Keep the package import intact so both consumers resolve its public exports.
await build({
    entryPoints: ['playwright/chunk-fixture.ts'],
    format: 'esm',
    target: 'es2022',
    outfile: '.playwright/chunk-entry.mjs',
})
await build({
    entryPoints: { main: '.playwright/chunk-entry.mjs' },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outdir: '.playwright/chunks/esm',
})
await new Promise((resolve, reject) => {
    rspack(
        {
            mode: 'production',
            devtool: false,
            target: ['web', 'es2022'],
            entry: './.playwright/chunk-entry.mjs',
            output: {
                path: fileURLToPath(new URL('../.playwright/chunks/rspack', import.meta.url)),
                filename: 'main.js',
                chunkFilename: '[name].js',
                publicPath: '/chunks/rspack/',
            },
            optimization: {
                splitChunks: {
                    cacheGroups: {
                        initialization: {
                            test: /automatic-analytics\.mjs$/,
                            name: 'initialization',
                            chunks: 'async',
                            enforce: true,
                        },
                        delivery: {
                            test: /analytics-delivery\.mjs$/,
                            name: 'delivery',
                            chunks: 'async',
                            enforce: true,
                        },
                        // Exercise a separate failed dependency, not just a failed import entry.
                        dependency: {
                            test: /capture-v1\.mjs$/,
                            name: 'delivery-dependency',
                            chunks: 'async',
                            enforce: true,
                        },
                    },
                },
            },
        },
        (error, stats) => {
            if (error || !stats || stats.hasErrors()) {
                reject(
                    error ?? new Error(stats?.toString({ all: false, errors: true }) ?? 'Missing Rspack build result')
                )
            } else {
                resolve()
            }
        }
    )
})
