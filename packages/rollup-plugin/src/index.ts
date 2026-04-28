import type { Plugin, OutputOptions, OutputAsset, OutputChunk } from 'rollup'
import { PluginConfig, ResolvedPluginConfig, resolveConfig, runSourcemapCli } from '@posthog/plugin-utils'
import path from 'node:path'
import fs from 'node:fs/promises'

// Re-export for backward compatibility
export type PostHogRollupPluginOptions = PluginConfig

export default function posthogRollupPlugin(userOptions: PostHogRollupPluginOptions) {
    const posthogOptions = resolveConfig(userOptions)
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
                const chunks: { [fileName: string]: OutputChunk } = {}
                const filePaths: string[] = []
                const basePaths: string[] = []

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
                        filePaths.push(chunkPath)
                    }
                }

                if (filePaths.length === 0) {
                    console.log(
                        'No chunks found, skipping sourcemap processing for this stage. Your build may be multi-stage and this stage may not be relevant'
                    )
                    return
                }

                await runSourcemapCli(posthogOptions, { filePaths })

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
