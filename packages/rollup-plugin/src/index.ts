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
        upload?: boolean
        project?: string
        version?: string
        deleteAfterUpload?: boolean
        batchSize?: number
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
        upload: boolean
        project?: string
        version?: string
        deleteAfterUpload: boolean
        batchSize?: number
    } & ({
        upload: true
        // these options are only for uploading
        deleteAfterUpload: boolean
        batchSize?: number
    } | {
        upload: false
        deleteAfterUpload: false
        batchSize?: never
    })
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
            const args = []
            if (posthogOptions.sourcemaps.upload) {
                // process injects and uploads in one command
                args.push('sourcemap', 'process')
            } else {
                // only injects the sourcemaps
                args.push('sourcemap', 'inject')
            }
            
            const cliPath = posthogOptions.cliBinaryPath
            if (options.dir) {
                for (const fileName in bundle) {
                    const chunk = bundle[fileName]
                    if (chunk.type === 'chunk') {
                        const chunkPath = path.resolve(options.dir, fileName)
                        args.push('--file', chunkPath)
                    }
                }
            } else if (options.file) {
                const filePath = path.resolve(options.file)
                args.push('--file', filePath)
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
            if (posthogOptions.sourcemaps.batchSize) {
                args.push('--batch-size', posthogOptions.sourcemaps.batchSize.toString())
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
    const userSourcemaps = userOptions.sourcemaps ?? {}

    const resolvedSourcemaps = {
        enabled: userSourcemaps.enabled ?? true,
        upload: userSourcemaps.upload ?? true,
        project: userSourcemaps.project,
        version: userSourcemaps.version,
    } as ResolvedPostHogRollupPluginOptions['sourcemaps']
    if (resolvedSourcemaps.upload) {
        resolvedSourcemaps.deleteAfterUpload = userSourcemaps.deleteAfterUpload ?? true
        resolvedSourcemaps.batchSize = userSourcemaps.batchSize
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
        sourcemaps: resolvedSourcemaps,
    }
    return posthogOptions
}
