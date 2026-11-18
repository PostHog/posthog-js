import { build } from 'esbuild'

await build({
    entryPoints: ['renderer.js'],
    outfile: 'dist/renderer.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome148',
    sourcemap: true,
})
