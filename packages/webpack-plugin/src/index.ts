import { createLogger, Logger } from '@posthog/core'
import { spawnLocal } from '@posthog/core/process'
import path from 'path'
import webpack from 'webpack'
import { PluginConfig, resolveConfig, ResolvedPluginConfig } from './config'

export * from './config'

export class PosthogWebpackPlugin {
    resolvedConfig: ResolvedPluginConfig
    logger: Logger

    constructor(pluginConfig: PluginConfig) {
        this.logger = createLogger('[PostHog Webpack]')
        this.resolvedConfig = resolveConfig(pluginConfig)
        assertValue(
            this.resolvedConfig.personalApiKey,
            `Personal API key not provided. If you are using turbo, make sure to add env variables to your turbo config`
        )
        assertValue(
            this.resolvedConfig.envId,
            `Environment ID not provided. If you are using turbo, make sure to add env variables to your turbo config`
        )
    }

    apply(compiler: webpack.Compiler): void {
        new compiler.webpack.SourceMapDevToolPlugin({
            filename: '[file].map',
            noSources: false,
            moduleFilenameTemplate: '[resource-path]',
            append: this.resolvedConfig.sourcemaps.deleteAfterUpload ? false : undefined,
        }).apply(compiler)

        const onDone = async (stats: webpack.Stats, callback: any): Promise<void> => {
            callback = callback || (() => {})
            try {
                await this.processSourceMaps(stats.compilation, this.resolvedConfig)
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : error
                this.logger.error('Error running PostHog webpack plugin:', errorMessage)
            }
            return callback()
        }

        if (compiler.hooks) {
            compiler.hooks.done.tapAsync('PosthogWebpackPlugin', onDone)
        } else {
            throw new Error('PosthogWebpackPlugin is not compatible with webpack version < 5')
        }
    }

    async processSourceMaps(compilation: webpack.Compilation, config: ResolvedPluginConfig): Promise<void> {
        const outputDirectory = compilation.outputOptions.path
        const args = []

        // chunks are output outside of the output directory for server chunks
        if (config.sourcemaps.upload) {
            // process injects and uploads in one command
            args.push('sourcemap', 'process')
        } else {
            // only injects the sourcemaps
            args.push('sourcemap', 'inject')
        }

        const chunkArray = Array.from(compilation.chunks)

        if (chunkArray.length == 0) {
            // No chunks generated, skipping sourcemap processing.
            return
        }

        chunkArray.forEach((chunk) =>
            chunk.files.forEach((file) => {
                const chunkPath = path.resolve(outputDirectory, file)
                args.push('--file', chunkPath)
            })
        )

        if (config.sourcemaps.project) {
            args.push('--project', config.sourcemaps.project)
        }

        if (config.sourcemaps.version) {
            args.push('--version', config.sourcemaps.version)
        }

        if (config.sourcemaps.deleteAfterUpload) {
            args.push('--delete-after')
        }

        if (config.sourcemaps.batchSize) {
            args.push('--batch-size', config.sourcemaps.batchSize.toString())
        }

        await spawnLocal(config.cliBinaryPath, args, {
            cwd: process.cwd(),
            env: {
                RUST_LOG: `posthog_cli=${config.logLevel}`,
                ...process.env,
                POSTHOG_CLI_HOST: config.host,
                POSTHOG_CLI_TOKEN: config.personalApiKey,
                POSTHOG_CLI_ENV_ID: config.envId,
            },
            stdio: 'inherit',
        })
    }
}

function assertValue(value: any, message: string): void {
    if (!value) {
        throw new Error(message)
    }
}
