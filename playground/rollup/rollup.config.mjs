import posthog from '@posthog/rollup-plugin'
import packageJson from './package.json' with { type: 'json' }

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
            envId: process.env.POSTHOG_PROJECT_ID,
            host: process.env.POSTHOG_API_HOST,
            cliBinaryPath: process.env.POSTHOG_CLI_BINARY_PATH,
            logLevel: 'info',
            sourcemaps: {
                enabled: true,
                project: packageJson.name,
                version: packageJson.version,
            },
        }),
    ],
}
