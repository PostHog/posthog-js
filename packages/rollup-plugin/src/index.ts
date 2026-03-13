import type { Plugin, OutputOptions, OutputAsset, OutputChunk, SourceMapInput } from 'rollup'
import {
    spawnLocal,
    resolveBinaryPath,
    LogLevel,
    computeChunkId,
    buildCodeSnippet,
    buildChunkComment,
} from '@posthog/core/process'
import path from 'node:path'

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

// Maps chunk filename to its computed chunk ID, shared between renderChunk and generateBundle
type ChunkIdMap = Map<string, string>

export default function posthogRollupPlugin(userOptions: PostHogRollupPluginOptions) {
    const posthogOptions = resolveOptions(userOptions)
    const chunkIdMap: ChunkIdMap = new Map()

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

        renderChunk: {
            order: 'post' as const,
            handler(code: string, chunk: { fileName: string }) {
                if (!posthogOptions.sourcemaps.enabled) return null

                // Compute deterministic chunk ID from pre-injection code.
                // The source map is not yet finalized at renderChunk time, so we hash
                // only the code. This is still deterministic: identical code always
                // produces the same chunk ID.
                const chunkId = computeChunkId(code, '')
                chunkIdMap.set(chunk.fileName, chunkId)

                const snippet = buildCodeSnippet(chunkId)
                const comment = buildChunkComment(chunkId)

                // Rollup automatically adjusts source maps when renderChunk returns
                // modified code. Using an empty-mappings map tells Rollup this is
                // an identity transform (only column offsets on line 1 are slightly
                // shifted by the snippet length — acceptable for error tracking).
                return {
                    code: snippet + code + comment,
                    map: { mappings: '' } as SourceMapInput,
                }
            },
        },

        generateBundle: {
            order: 'post' as const,
            handler(_options: OutputOptions, bundle: { [fileName: string]: OutputAsset | OutputChunk }) {
                if (!posthogOptions.sourcemaps.enabled) return

                // Stamp chunk_id into source map JSON files so the CLI upload can read them
                for (const [fileName, chunkId] of chunkIdMap) {
                    const mapFileName = `${fileName}.map`
                    const mapAsset = bundle[mapFileName]

                    if (mapAsset && mapAsset.type === 'asset') {
                        try {
                            const mapJson = JSON.parse(mapAsset.source.toString())
                            mapJson.chunk_id = chunkId
                            ;(mapAsset as OutputAsset).source = JSON.stringify(mapJson)
                        } catch {
                            // Skip if source map isn't valid JSON
                        }
                    }

                    // Also update chunk.map if present
                    const chunk = bundle[fileName]
                    if (chunk && chunk.type === 'chunk' && chunk.map) {
                        ;(chunk.map as unknown as Record<string, unknown>).chunk_id = chunkId
                    }
                }

                chunkIdMap.clear()
            },
        },

        writeBundle: {
            sequential: true,
            async handler(options: OutputOptions, bundle: { [fileName: string]: OutputAsset | OutputChunk }) {
                if (!posthogOptions.sourcemaps.enabled) return
                const args = ['sourcemap', 'upload']
                const cliPath = posthogOptions.cliBinaryPath
                const basePaths: string[] = []

                if (options.dir) {
                    basePaths.push(options.dir)
                }

                if (options.file) {
                    basePaths.push(path.dirname(options.file))
                }

                let hasChunks = false

                for (const fileName in bundle) {
                    const chunk = bundle[fileName]
                    const isJsFile = /\.(js|mjs|cjs)$/.test(fileName)
                    if (chunk.type === 'chunk' && isJsFile) {
                        const chunkPath = path.resolve(...basePaths, fileName)
                        args.push('--file', chunkPath)
                        hasChunks = true
                    }
                }

                if (!hasChunks) {
                    console.log(
                        'No chunks found, skipping sourcemap upload for this stage. Your build may be multi-stage and this stage may not be relevant'
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
