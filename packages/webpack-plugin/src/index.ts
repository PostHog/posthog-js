import { Logger, createLogger } from '@posthog/core'
import { PluginConfig, resolveConfig, ResolvedPluginConfig } from './config'
import { runSourcemapCli } from '@posthog/plugin-utils'
import webpack from 'webpack'
import path from 'path'

export * from './config'

export class PosthogWebpackPlugin {
    resolvedConfig: ResolvedPluginConfig
    logger: Logger

    constructor(pluginConfig: PluginConfig)
    constructor(pluginConfig: ResolvedPluginConfig, resolved: true)
    constructor(pluginConfig: PluginConfig | ResolvedPluginConfig, resolved?: boolean) {
        this.logger = createLogger('[PostHog Webpack]')
        this.resolvedConfig = resolved
            ? (pluginConfig as ResolvedPluginConfig)
            : resolveConfig(pluginConfig as PluginConfig)
    }

    apply(compiler: webpack.Compiler): void {
        if (this.resolvedConfig.sourcemaps.enabled) {
            new compiler.webpack.SourceMapDevToolPlugin({
                filename: '[file].map',
                noSources: false,
                moduleFilenameTemplate: '[resource-path]',
                append: this.resolvedConfig.sourcemaps.deleteAfterUpload ? false : undefined,
            }).apply(compiler)
        }

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
        if (!config.sourcemaps.enabled) return

        const outputDirectory = compilation.outputOptions.path
        const chunkArray = Array.from(compilation.chunks)

        if (chunkArray.length == 0) {
            // No chunks generated, skipping sourcemap processing.
            return
        }

        const filePaths: string[] = []
        chunkArray.forEach((chunk) =>
            chunk.files.forEach((file) => {
                const chunkPath = path.resolve(outputDirectory, file)
                filePaths.push(chunkPath)
            })
        )

        await runSourcemapCli(config, { filePaths })
    }
}
