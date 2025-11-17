import { Logger, createLogger } from '@posthog/core'
import { PluginConfig, resolveConfig, ResolvedPluginConfig } from './config'
import { Compilation, Stats } from 'webpack'
import { spawnLocal } from '@posthog/core/process'

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
        compiler.options.devtool =
            compiler.options.devtool ?? (this.resolvedConfig.sourcemaps.enabled ? 'source-map' : undefined)

        const onDone = async (stats: Stats, callback: any): Promise<void> => {
            callback = callback || (() => {})
            try {
                await this.processSourceMaps(stats.compilation, this.resolvedConfig)
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : error
                return this.logger.error('Error running PostHog sourcemap plugin:', errorMessage)
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
        const args = ['sourcemap', 'process', '--directory', outputDirectory]

        for (const chunk of compilation.chunks) {
            // chunk.files is a Set in webpack 5
            for (const file of chunk.files) {
                args.push('--include', `**/${file}`)
            }
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

        this.logger.info(args)

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

async function assertValue(value: any, message: string): Promise<void> {
    if (!value) {
        throw new Error(message)
    }
}
