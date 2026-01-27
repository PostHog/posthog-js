import type { Plugin, OutputOptions, OutputAsset, OutputChunk } from 'rollup'
import { spawnLocal, resolveBinaryPath, LogLevel } from '@posthog/core/process'
import path from 'node:path'
import fs from 'node:fs/promises'

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
        project?: string
        version?: string
        deleteAfterUpload: boolean
        batchSize?: number
    }
}

export default function posthogRollupPlugin(userOptions: PostHogRollupPluginOptions) {
    const posthogOptions = resolveOptions(userOptions)
    return {
        name: 'posthog-rollup-plugin',

        outputOptions: {
            order: 'post',
            handler(options: OutputOptions) {
                return {
                    ...options,
                    sourcemap: posthogOptions.sourcemaps.deleteAfterUpload ? 'hidden' : true,
                }
            },
        },

        writeBundle: {
            // Write bundle is executed in parallel, make it sequential to ensure correct order
            sequential: true,
            async handler(options: OutputOptions, bundle: { [fileName: string]: OutputAsset | OutputChunk }) {
                if (!posthogOptions.sourcemaps.enabled) return
                const args = ['sourcemap', 'process']
                const cliPath = posthogOptions.cliBinaryPath
                const chunks: { [fileName: string]: OutputChunk } = {}
                const basePaths = []

                if (options.dir) {
                    basePaths.push(options.dir)
                }

                if (options.file) {
                    basePaths.push(path.dirname(options.file))
                }

                for (const fileName in bundle) {
                    const chunk = bundle[fileName]
                    if (chunk.type === 'chunk') {
                        const chunkPath = path.resolve(...basePaths, fileName)
                        chunks[chunkPath] = chunk
                        args.push('--file', chunkPath)
                    }
                }

                // Skip if there are no chunks to process
                if (Object.keys(chunks).length === 0) {
                    console.log('No chunks found, skipping sourcemap processing')
                    return
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

                // we need to update code for others plugins to work
                await Promise.all(
                    Object.entries(chunks).map(([chunkPath, chunk]) =>
                        fs.readFile(chunkPath, 'utf8').then((content) => {
                            chunk.code = content
                        })
                    )
                )
            },
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
            enabled: userSourcemaps.enabled ?? true,
            deleteAfterUpload: userSourcemaps.deleteAfterUpload ?? true,
            batchSize: userSourcemaps.batchSize,
            project: userSourcemaps.project,
            version: userSourcemaps.version,
        },
    }
    return posthogOptions
}
