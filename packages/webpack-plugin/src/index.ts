import { Logger, createLogger } from '@posthog/core'
import { PluginConfig, resolveConfig, ResolvedPluginConfig } from './config'
import { Compilation, Stats } from 'webpack'
import { spawnLocal } from '@posthog/core/process'
import path from 'path'

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

    apply(compiler: any): void {
        const onDone = async (stats: Stats, callback: any): Promise<void> => {
            callback = callback || (() => {})
            try {
                await this.processSourceMaps(stats.compilation, this.resolvedConfig)
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : error
                this.logger.error('Error running PostHog sourcemap plugin:', errorMessage)
            }
            return callback()
        }

        if (compiler.hooks) {
            compiler.hooks.done.tapAsync('SourcemapWebpackPlugin', onDone)
        } else {
            compiler.plugin('done', onDone)
        }
    }

    async processSourceMaps(compilation: Compilation, config: ResolvedPluginConfig): Promise<void> {
        const outputDirectory = compilation.outputOptions.path

        // chunks are output outside of the output directory for server chunks
        const args = ['sourcemap', 'process']
        const chunkArray = Array.from(compilation.chunks)

        if (chunkArray.length == 0) {
            // No chunks generated, skipping sourcemap processing.
            return
        }

        const filePaths = chunkArray.flatMap((chunk) =>
            Array.from(chunk.files).map((file) => path.resolve(outputDirectory, file))
        )
        const [commonDirectory, relativeFilePaths] = splitFilePaths(filePaths)

        args.push('--directory', commonDirectory)

        for (const chunkPath of relativeFilePaths) {
            args.push('--include', `**/${chunkPath}`)
        }

        if (config.sourcemaps.project) {
            args.push('--project', config.sourcemaps.project)
        }

        if (config.sourcemaps.version) {
            args.push('--version', config.sourcemaps.version)
        }

        if (config.sourcemaps.deleteAfterUpload) {
            args.push('--delete-after')
        }

        await spawnLocal(config.cliBinaryPath, args, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                RUST_LOG: `posthog_cli=${config.logLevel}`,
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

// Convert a list of absolute file path to a common absolute directory ancestor path and relative path
function splitFilePaths(absolutePaths: string[]): [string, string[]] {
    if (!absolutePaths || absolutePaths.length === 0) {
        return [process.cwd(), []]
    }

    // Start with the directory of the first path and walk up until we find a common ancestor
    let commonDir = path.dirname(absolutePaths[0])

    const isCommonAncestor = (candidate: string): boolean => {
        return absolutePaths.every((p) => {
            const rel = path.relative(candidate, p)
            // If rel starts with '..' or is absolute, p is not inside candidate
            return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
        })
    }

    // If the first candidate isn't a common ancestor, walk up the directory tree
    while (!isCommonAncestor(commonDir)) {
        const parent = path.dirname(commonDir)
        if (parent === commonDir) {
            // reached filesystem root
            break
        }
        commonDir = parent
    }

    // Compute relative paths from the common directory, normalize to forward slashes for globs
    const relativePaths = absolutePaths.map((p) => path.relative(commonDir, p).replace(/\\/g, '/'))

    return [commonDir, relativePaths]
}
