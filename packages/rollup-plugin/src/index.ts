import type { Plugin, OutputOptions, OutputAsset, OutputChunk } from 'rollup'
import { spawnLocal, resolveBinaryPath, LogLevel } from '@posthog/core/process'
import path from 'node:path'

export interface PostHogRollupPluginOptions {
    personalApiKey: string
    envId: string
    host?: string
    cliBinaryPath?: string
    logLevel?: LogLevel
    sourcemaps?: {
        enabled?: boolean
        project?: string
        version?: string
        deleteAfterUpload?: boolean
    }
}

interface ResolvedPostHogRollupPluginOptions {
    personalApiKey: string
    envId: string
    host: string
    cliBinaryPath: string
    logLevel: LogLevel
    sourcemaps: {
        enabled: boolean
        project?: string
        version?: string
        deleteAfterUpload: boolean
    }
}

export default function posthogRollupPlugin(userOptions: PostHogRollupPluginOptions) {
    const posthogOptions = resolveOptions(userOptions)
    return {
        name: 'posthog-rollup-plugin',
        outputOptions: {
            order: 'post',
            handler(options) {
                return {
                    ...options,
                    sourcemap: true,
                }
            },
        },
        async writeBundle(options: OutputOptions, bundle: { [fileName: string]: OutputAsset | OutputChunk }) {
            if (!posthogOptions.sourcemaps.enabled) return
            const args = ['sourcemap', 'process']
            const cliPath = posthogOptions.cliBinaryPath
            if (options.dir) {
                const directory = path.resolve(options.dir)
                args.push('--directory', directory)
                for (const fileName in bundle) {
                    const chunk = bundle[fileName]
                    if (chunk.type === 'chunk') {
                        args.push('--include', `**/${fileName}`)
                    }
                }
            } else if (options.file) {
                const filePath = path.resolve(options.file)
                const parentDirectory = path.dirname(filePath)
                args.push('--directory', parentDirectory)
                args.push('--include', filePath)
            }
            if (posthogOptions.sourcemaps.project) {
                args.push('--project', posthogOptions.sourcemaps.project)
            }
            if (posthogOptions.sourcemaps.version) {
                args.push('--version', posthogOptions.sourcemaps.version)
            }
            if (posthogOptions.sourcemaps.deleteAfterUpload) {
                args.push('--delete-after')
            }
            await spawnLocal(cliPath, args, {
                env: {
                    ...process.env,
                    RUST_LOG: `posthog_cli=${posthogOptions.logLevel}`,
                    POSTHOG_CLI_HOST: posthogOptions.host,
                    POSTHOG_CLI_TOKEN: posthogOptions.personalApiKey,
                    POSTHOG_CLI_ENV_ID: posthogOptions.envId,
                },
                stdio: 'inherit',
                cwd: process.cwd(),
            })
        },
    } as Plugin
}

function resolveOptions(userOptions: PostHogRollupPluginOptions): ResolvedPostHogRollupPluginOptions {
    if (!userOptions.envId) {
        throw new Error('envId is required')
    } else if (!userOptions.personalApiKey) {
        throw new Error('personalApiKey is required')
    }
    const userSourcemaps = userOptions.sourcemaps ?? {
        enabled: false,
    }
    const posthogOptions: ResolvedPostHogRollupPluginOptions = {
        host: userOptions.host || 'https://us.i.posthog.com',
        personalApiKey: userOptions.personalApiKey,
        envId: userOptions.envId,
        cliBinaryPath:
            userOptions.cliBinaryPath ??
            resolveBinaryPath('posthog-cli', {
                path: process.env.PATH ?? '',
                cwd: process.cwd(),
            }),
        logLevel: userOptions.logLevel ?? 'info',
        sourcemaps: {
            enabled: userSourcemaps.enabled ?? false,
            deleteAfterUpload: userSourcemaps.deleteAfterUpload ?? true,
        },
    }
    return posthogOptions
}
