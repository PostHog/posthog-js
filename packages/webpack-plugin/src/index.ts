import { Logger, createLogger } from '@posthog/core'
import { PluginConfig, resolveConfig, ResolvedPluginConfig } from './config'
import {
    runSourcemapCli,
    resolveReleaseId,
    createChunkId,
    createStableChunkId,
    createChunkIdSnippet,
    createChunkIdComment,
    determineChunkIdFromSource,
} from '@posthog/plugin-utils'
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
const JS_CHUNK_REGEX = /\.[mc]?js$/

// Keep hashbangs and directive prologues ahead of the runtime snippet (as in the Rollup plugin).
const PROLOGUE_REGEX =
    /^(?:#![^\n]*\n)?(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$)|(?:"[^"\\\n]*"|'[^'\\\n]*')(?:\s*(?:\/\*[\s\S]*?\*\/\s*)*;|[^\S\n]*(?:\/\*[^\n]*?\*\/[^\S\n]*)*(?:\/\/[^\n]*)?\n(?!\s*(?:!=|[+\-*/%.,([?:<>=&|^~`]|in\b|instanceof\b))))*/

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
        const failedCompilations = new WeakSet<webpack.Compilation>()
        if (this.resolvedConfig.sourcemaps.enabled) {
            // In event release mode webpack stamps an ECMA-426 debug id into each chunk at
            // compile time, and we adopt it as the chunk id instead of deriving another,
            // so one id identifies the chunk across the whole toolchain. On webpacks
            // without the option we fall back to content-derived ids, which are equally
            // stable — just not shared with other tooling.
            const eventReleaseMode = this.resolvedConfig.sourcemaps.releaseMode === 'event'
            new compiler.webpack.SourceMapDevToolPlugin({
                filename: '[file].map',
                noSources: false,
                moduleFilenameTemplate: '[resource-path]',
                append: this.resolvedConfig.sourcemaps.deleteAfterUpload ? false : undefined,
                ...(eventReleaseMode && webpackSupportsDebugIds(compiler.webpack.version) ? { debugIds: true } : {}),
            }).apply(compiler)

            compiler.hooks.compilation.tap('PosthogWebpackPlugin', (compilation) => {
                compilation.hooks.processAssets.tapPromise(
                    {
                        name: 'PosthogWebpackPlugin',
                        // Maps (including native debug ids) exist now, but content hashes and
                        // Next.js's afterProcessAssets integrity manifest have not been finalized.
                        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_DEV_TOOLING + 1,
                    },
                    async () => {
                        // Per compilation: watch rebuilds must resolve their own release.
                        let releaseIdPromise: Promise<string | undefined> | undefined
                        let warnedAboutMissingRelease = false
                        try {
                            for (const chunk of compilation.chunks) {
                                for (const file of chunk.files) {
                                    if (!JS_CHUNK_REGEX.test(file)) continue
                                    const asset = compilation.getAsset(file)
                                    const mapAsset = compilation.getAsset(`${file}.map`)
                                    if (!asset || !mapAsset) continue
                                    const code = asset.source.source().toString()
                                    const map = JSON.parse(mapAsset.source.source().toString())
                                    const existingId = determineChunkIdFromSource(code)
                                    const chunkId =
                                        existingId ??
                                        (eventReleaseMode
                                            ? (map.debugId ?? createStableChunkId(code))
                                            : createChunkId())
                                    if (existingId) {
                                        compilation.updateAsset(file, asset.source, {
                                            ...asset.info,
                                            posthogChunkId: chunkId,
                                        })
                                        if (eventReleaseMode) {
                                            this.logger.warn(
                                                `PostHog: ${file} already carries a chunk id, so no release id was injected`
                                            )
                                        }
                                        compilation.updateAsset(
                                            `${file}.map`,
                                            new compiler.webpack.sources.RawSource(
                                                JSON.stringify({ ...map, chunk_id: chunkId })
                                            )
                                        )
                                        continue
                                    }
                                    const releaseId = eventReleaseMode
                                        ? await (releaseIdPromise ??= resolveReleaseId(this.resolvedConfig))
                                        : undefined
                                    if (eventReleaseMode && !releaseId && !warnedAboutMissingRelease) {
                                        warnedAboutMissingRelease = true
                                        this.logger.warn(
                                            'No release could be resolved, injecting chunk ids only. Set sourcemaps.releaseName and sourcemaps.releaseVersion, or build from git or a supported CI environment.'
                                        )
                                    }
                                    const source = new compiler.webpack.sources.ReplaceSource(
                                        new compiler.webpack.sources.SourceMapSource(code, file, map)
                                    )
                                    source.insert(
                                        code.match(PROLOGUE_REGEX)?.[0].length ?? 0,
                                        createChunkIdSnippet(chunkId, releaseId)
                                    )
                                    const injected = new compiler.webpack.sources.ConcatSource(
                                        source,
                                        createChunkIdComment(chunkId)
                                    )
                                    // The external map is updated below. Keep the JS source map-free,
                                    // like SourceMapDevToolPlugin, so its additional-assets pass cannot
                                    // regenerate a second map from the injected source.
                                    const injectedCode = new compiler.webpack.sources.RawSource(injected.source())
                                    const injectedMap = new compiler.webpack.sources.RawSource(
                                        JSON.stringify({
                                            ...map,
                                            ...injected.map(),
                                            file: map.file,
                                            chunk_id: chunkId,
                                        })
                                    )
                                    compilation.updateAsset(file, injectedCode, {
                                        ...asset.info,
                                        posthogChunkId: chunkId,
                                    })
                                    compilation.updateAsset(`${file}.map`, injectedMap)
                                }
                            }
                        } catch (error) {
                            // Match the existing fail-soft upload hook; never delete maps for a
                            // compilation whose injection/release resolution did not complete.
                            failedCompilations.add(compilation)
                            this.logger.error('Error injecting PostHog chunk ids:', error)
                        }
                    }
                )
            })
        }

        const onDone = async (stats: webpack.Stats, callback: any): Promise<void> => {
            callback = callback || (() => {})
            try {
                if (!failedCompilations.has(stats.compilation)) {
                    await this.processSourceMaps(stats.compilation, this.resolvedConfig)
                }
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
                if (!JS_CHUNK_REGEX.test(file)) return
                const asset = compilation.getAsset(file)
                // webpack replaces emitted sources with SizeOnlySource before `done`.
                // Asset info survives emission and content-hash renames.
                if (!asset?.info.posthogChunkId) return
                filePaths.push(path.resolve(outputDirectory, file))
            })
        )

        if (filePaths.length > 0) {
            // Files are final: `process` and `--delete-after` rewrite JS and invalidate SRI.
            await runSourcemapCli(config, { filePaths, command: 'upload' })
        }

        if (config.sourcemaps.deleteAfterUpload) {
            await this.deleteCssSourceMaps(compilation, outputDirectory)
            const results = await Promise.allSettled(filePaths.map((file) => fs.rm(`${file}.map`, { force: true })))
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    this.logger.error(
                        'PostHog sourcemaps uploaded, but failed to delete source map:',
                        `${filePaths[index]}.map`,
                        result.reason
                    )
                }
            })
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
