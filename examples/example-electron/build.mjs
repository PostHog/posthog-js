import { build } from 'esbuild'

await build({
    entryPoints: ['renderer.js'],
    outfile: 'dist/renderer.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome146',
    sourcemap: true,
})

await build({
    entryPoints: ['fixtures/composed-preload.js'],
    outfile: 'dist/composed-preload.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
})
