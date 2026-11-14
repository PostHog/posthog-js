import { defineConfig } from '@rslib/core'

export default defineConfig({
    bundle: false,
    dts: true,
    syntax: 'es6',
    lib: [{ format: 'cjs' }],
    source: {
        entry: {
            index: ['src/**/*.js'],
        },
        tsconfigPath: './tsconfig.json',
    },
    output: {
        externals: ['@docusaurus/ExecutionEnvironment'],
    },
    tools: {
        rspack: {
            output: {
                // Preserve require('posthog-docusaurus') as the plugin function.
                library: { type: 'commonjs2' },
            },
        },
    },
})
