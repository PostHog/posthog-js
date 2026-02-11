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
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    plugins: [
        new PosthogWebpackPlugin({
            personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
            projectId: process.env.POSTHOG_PROJECT_ID,
            host: process.env.POSTHOG_API_HOST,
            logLevel: 'error',
            cliBinaryPath: process.env.POSTHOG_CLI_PATH,
            sourcemaps: {
                enabled: true,
                releaseName: packageJson.name,
                releaseVersion: packageJson.version,
                deleteAfterUpload: true,
            },
        }),
    ],
}

export default config
