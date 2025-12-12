import path from 'node:path'
import webpack from 'webpack'
import { PosthogWebpackPlugin } from '@posthog/webpack-plugin'
import packageJson from './package.json'

const config: webpack.Configuration = {
    mode: 'production',
    entry: './src/index.ts',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
    },
    plugins: [
        new PosthogWebpackPlugin({
            personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
            envId: process.env.POSTHOG_PROJECT_ID,
            host: process.env.POSTHOG_API_HOST,
            logLevel: 'error',
            cliBinaryPath: process.env.POSTHOG_CLI_PATH,
            sourcemaps: {
                enabled: true,
                project: packageJson.name,
                version: packageJson.version,
                deleteAfterUpload: true,
            },
        }),
    ],
}

export default config
