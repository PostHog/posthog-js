import { Logger, createLogger } from '@posthog/core'
import { PluginConfig, resolveConfig, ResolvedPluginConfig } from './config'
import { runSourcemapCli } from '@posthog/plugin-utils'
import webpack from 'webpack'
import path from 'path'
import fs from 'fs/promises'

export * from './config'

// webpack validates SourceMapDevToolPlugin options against its schema, so passing `debugIds` to a
// webpack that predates the option fails the build outright. 5.97.0 added it; 5.104.0 fixed its
// interplay with builds that suppress the sourceMappingURL comment (`append: false`, the
// deleteAfterUpload default), so that's the floor.
const DEBUG_IDS_MIN_MAJOR = 5
const DEBUG_IDS_MIN_MINOR = 104

function webpackSupportsDebugIds(version: string | undefined): boolean {
    if (!version) {
        return false
    }
    const [major = NaN, minor = NaN] = version.split('.').map((part) => Number.parseInt(part, 10))
    return major > DEBUG_IDS_MIN_MAJOR || (major === DEBUG_IDS_MIN_MAJOR && minor >= DEBUG_IDS_MIN_MINOR)
}

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
            // In event release mode webpack stamps an ECMA-426 debug id into each chunk at
            // compile time, and posthog-cli adopts it as the chunk id instead of deriving its
            // own, so one id identifies the chunk across the whole toolchain. On webpacks
            // without the option the CLI falls back to content-derived ids, which are equally
            // stable — just not shared with other tooling.
            const eventReleaseMode = this.resolvedConfig.sourcemaps.releaseMode === 'event'
            new compiler.webpack.SourceMapDevToolPlugin({
                filename: '[file].map',
                noSources: false,
                moduleFilenameTemplate: '[resource-path]',
                append: this.resolvedConfig.sourcemaps.deleteAfterUpload ? false : undefined,
                ...(eventReleaseMode && webpackSupportsDebugIds(compiler.webpack.version) ? { debugIds: true } : {}),
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

        if (config.sourcemaps.deleteAfterUpload) {
            await this.deleteCssSourceMaps(compilation, outputDirectory)
        }
    }

    private async deleteCssSourceMaps(compilation: webpack.Compilation, outputDirectory: string): Promise<void> {
        const cssSourceMaps = compilation
            .getAssets()
            .filter((asset) => asset.name.endsWith('.css.map'))
            .map((asset) => path.resolve(outputDirectory, asset.name))

        const deletionResults = await Promise.allSettled(
            cssSourceMaps.map((filePath) => fs.rm(filePath, { force: true }))
        )

        deletionResults.forEach((result, index) => {
            if (result.status === 'rejected') {
                const errorMessage = result.reason instanceof Error ? result.reason.message : result.reason
                this.logger.error(
                    'PostHog sourcemaps uploaded, but failed to delete CSS source map:',
                    cssSourceMaps[index],
                    errorMessage
                )
            }
        })
    }
}
