import type { Plugin, OutputOptions, OutputAsset, OutputChunk } from 'rollup'
import { spawnLocal, resolveBinaryPath, LogLevel } from '@posthog/core/process'
import path from 'node:path'
import fs from 'node:fs/promises'

export interface PostHogRollupPluginOptions {
    personalApiKey: string
    /** @deprecated Use projectId instead */
    envId?: string
    projectId?: string
    host?: string
    cliBinaryPath?: string
    logLevel?: LogLevel
    sourcemaps?: {
        enabled?: boolean
        /** @deprecated Use releaseName instead */
        project?: string
        releaseName?: string
        /** @deprecated Use releaseVersion instead */
        version?: string
        releaseVersion?: string
        deleteAfterUpload?: boolean
        batchSize?: number
    }
}

interface ResolvedPostHogRollupPluginOptions {
    personalApiKey: string
    projectId: string
    host: string
    cliBinaryPath: string
    logLevel: LogLevel
    sourcemaps: {
        enabled: boolean
        releaseName?: string
        releaseVersion?: string
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
                    const isJsFile = /\.(js|mjs|cjs)$/.test(fileName)
                    if (chunk.type === 'chunk' && isJsFile) {
                        const chunkPath = path.resolve(...basePaths, fileName)
                        chunks[chunkPath] = chunk
                        args.push('--file', chunkPath)
                    }
                }

                if (Object.keys(chunks).length === 0) {
                    console.log(
                        'No chunks found, skipping sourcemap processing for this stage. Your build may be multi-stage and this stage may not be relevant'
                    )
                    return
                }

                if (posthogOptions.sourcemaps.releaseName) {
                    args.push('--release-name', posthogOptions.sourcemaps.releaseName)
                }
                if (posthogOptions.sourcemaps.releaseVersion) {
                    args.push('--release-version', posthogOptions.sourcemaps.releaseVersion)
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
                        POSTHOG_CLI_API_KEY: posthogOptions.personalApiKey,
                        POSTHOG_CLI_PROJECT_ID: posthogOptions.projectId,
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
    const projectId = userOptions.projectId ?? userOptions.envId
    if (!projectId) {
        throw new Error('projectId is required (envId is deprecated)')
    } else if (!userOptions.personalApiKey) {
        throw new Error('personalApiKey is required')
    }
    const userSourcemaps = userOptions.sourcemaps ?? {}
    const posthogOptions: ResolvedPostHogRollupPluginOptions = {
        host: userOptions.host || 'https://us.i.posthog.com',
        personalApiKey: userOptions.personalApiKey,
        projectId,
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
            releaseName: userSourcemaps.releaseName ?? userSourcemaps.project,
            releaseVersion: userSourcemaps.releaseVersion ?? userSourcemaps.version,
        },
    }
    return posthogOptions
}
