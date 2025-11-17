import posthog from '@posthog/rollup-plugin'

export default {
    input: './src/index.ts',
    output: [
        {
            format: 'es',
            dir: 'dist/esm',
        },
        {
            format: 'cjs',
            dir: 'dist/cjs',
        },
        {
            format: 'iife',
            file: 'dist/index.iife.js',
        },
    ],
    plugins: [
        posthog({
            personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
            envId: process.env.POSTHOG_API_PROJECT,
            host: process.env.POSTHOG_API_HOST,
            cliBinaryPath: process.env.POSTHOG_CLI_BINARY_PATH,
            sourcemap: {
                project: 'my-project',
                version: '1.0.0',
            },
        }),
    ],
}
