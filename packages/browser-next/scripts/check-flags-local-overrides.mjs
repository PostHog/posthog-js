import { build } from 'esbuild'
import { createRequire } from 'node:module'
import process from 'node:process'

const result = await build({
    entryPoints: ['fixtures/flags-local-overrides.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
})
const { verifyLocalOverrides } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
)
await verifyLocalOverrides()
const require = createRequire(import.meta.url)
await verifyLocalOverrides(
    require('@posthog/browser/core').createPostHog,
    require('@posthog/browser/flags').featureFlags
)
process.stdout.write('Local flag overrides public exports passed (ESM and CommonJS)\n')
