import type { Plugin, OutputOptions, OutputAsset, OutputChunk, RenderedChunk } from 'rollup'
import {
    PluginConfig,
    resolveConfig,
    runSourcemapCli,
    createChunkId,
    createChunkIdSnippet,
    createChunkIdComment,
    determineChunkIdFromSource,
} from '@posthog/plugin-utils'
import path from 'node:path'
import fs from 'node:fs/promises'
import MagicString from 'magic-string'

// Re-export for backward compatibility
export type PostHogRollupPluginOptions = PluginConfig

// The `config` hook is Vite-specific: Vite runs it before the build to force sourcemap
// generation, while Rollup ignores unknown hooks.
type PostHogRollupPlugin = Plugin & {
    config: () => { build: { sourcemap: boolean | 'hidden' } } | undefined
}

const JS_CHUNK_REGEX = /\.(js|mjs|cjs)$/

// Matches a leading hashbang plus the whole directive prologue — comments and
// string literal statements like "use strict" or "use client". The snippet
// must be injected after them: before a hashbang it breaks the file, before a
// directive it silently demotes the directive to a no-op expression. A string
// counts only when terminated by `;`, or by a newline (ASI) whose next token
// cannot continue the expression — `"undefined"!=typeof x` or `"a"\n.trim()`
// are expressions that injecting into would split into a SyntaxError. When in
// doubt the prologue ends and the snippet goes to offset 0, which is always
// syntactically safe.
const PROLOGUE_REGEX =
    /^(?:#![^\n]*\n)?(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$)|(?:"[^"\\\n]*"|'[^'\\\n]*')(?:\s*;|[^\S\n]*\n(?!\s*(?:!=|[+\-*/%.,([?:<>=&|^~`]|in\b|instanceof\b))))*/

export default function posthogRollupPlugin(userOptions: PostHogRollupPluginOptions): Plugin {
    const posthogOptions = resolveConfig(userOptions)
    const plugin: PostHogRollupPlugin = {
        name: 'posthog-rollup-plugin',

        config() {
            if (!posthogOptions.sourcemaps.enabled) return

            return {
                build: {
                    sourcemap: posthogOptions.sourcemaps.deleteAfterUpload ? 'hidden' : true,
                },
            }
        },

        outputOptions: {
            order: 'post',
            handler(options: OutputOptions) {
                if (!posthogOptions.sourcemaps.enabled) return options

                return {
                    ...options,
                    sourcemap: posthogOptions.sourcemaps.deleteAfterUpload ? 'hidden' : true,
                }
            },
        },

        // Chunk ids are injected in-memory, before rollup writes the files and
        // before `generateBundle` — where SRI plugins (e.g. vite-plugin-sri3)
        // compute integrity hashes and rollup resolves [hash] file names. The
        // written files are final; nothing may rewrite them afterwards.
        renderChunk: {
            order: 'post',
            handler(code: string, chunk: RenderedChunk) {
                if (!posthogOptions.sourcemaps.enabled) return null
                if (!JS_CHUNK_REGEX.test(chunk.fileName)) return null
                // Already carries an id (watch-mode re-render, another tool)
                if (determineChunkIdFromSource(code)) return null

                const chunkId = createChunkId()
                const magicString = new MagicString(code)
                magicString.appendLeft(code.match(PROLOGUE_REGEX)?.[0].length ?? 0, createChunkIdSnippet(chunkId))
                magicString.append(createChunkIdComment(chunkId))

                return {
                    code: magicString.toString(),
                    map: magicString.generateMap({ hires: 'boundary' }),
                }
            },
        },

        writeBundle: {
            // Serializes with other writeBundle hooks within this output only —
            // multi-output builds still upload concurrently.
            sequential: true,
            async handler(options: OutputOptions, bundle: { [fileName: string]: OutputAsset | OutputChunk }) {
                if (!posthogOptions.sourcemaps.enabled) return
                const filePaths: string[] = []
                const mapPaths: string[] = []
                const basePaths: string[] = []

                if (options.dir) {
                    basePaths.push(options.dir)
                }

                if (options.file) {
                    basePaths.push(path.dirname(options.file))
                }

                for (const fileName in bundle) {
                    const chunk = bundle[fileName]
                    if (chunk.type !== 'chunk' || !JS_CHUNK_REGEX.test(fileName)) continue

                    // Prebuilt chunks (`emitFile({type: 'prebuilt-chunk'})`) never
                    // pass through renderChunk and carry no chunk id — including
                    // them would abort the CLI's all-or-nothing upload.
                    if (!determineChunkIdFromSource(chunk.code)) continue

                    filePaths.push(path.resolve(...basePaths, fileName))

                    // The CLI can only associate a hidden map located right next
                    // to its chunk (`<file>.map`); with a custom sourcemapFileNames
                    // layout it finds zero pairs and exits successfully — the
                    // build would silently upload no symbols. Fail fast instead.
                    // Visible maps are fine: the CLI follows the sourceMappingURL
                    // comment wherever it points.
                    const mapFileName = chunk.sourcemapFileName ?? `${fileName}.map`
                    if (mapFileName === `${fileName}.map`) {
                        mapPaths.push(path.resolve(...basePaths, mapFileName))
                    } else if (options.sourcemap === 'hidden') {
                        throw new Error(
                            `[posthog-rollup-plugin] custom output.sourcemapFileNames ('${mapFileName}') is not supported with hidden sourcemaps: posthog-cli can only discover a hidden map next to its chunk ('${fileName}.map'), so nothing would be uploaded. Use the default sourcemap file names, or keep sourcemaps visible (deleteAfterUpload: false).`
                        )
                    }
                }

                if (filePaths.length === 0) {
                    console.log(
                        'No chunks found, skipping sourcemap processing for this stage. Your build may be multi-stage and this stage may not be relevant'
                    )
                    return
                }

                // Upload only — the chunk ids were injected in renderChunk, so
                // `sourcemap process` (which rewrites the files on disk) is not
                // needed and would invalidate SRI hashes and content-hashed
                // file names.
                await runSourcemapCli(posthogOptions, { filePaths, command: 'upload' })

                // `--delete-after` also rewrites the .js files, so the plugin
                // deletes the maps itself. Only reached when the upload
                // succeeded — a throw above keeps the maps around. Cleanup
                // failures must not fail the (successful) build.
                if (posthogOptions.sourcemaps.deleteAfterUpload) {
                    const results = await Promise.allSettled(mapPaths.map((mapPath) => fs.rm(mapPath, { force: true })))
                    results.forEach((result, index) => {
                        if (result.status === 'rejected') {
                            console.warn(
                                `PostHog sourcemaps uploaded, but failed to delete source map ${mapPaths[index]}: ${result.reason}`
                            )
                        }
                    })
                }
            },
        },
    }
    return plugin
}
