import type { Plugin, OutputOptions, OutputAsset, OutputChunk, RenderedChunk, NormalizedOutputOptions } from 'rollup'
import {
    PluginConfig,
    resolveConfig,
    runSourcemapCli,
    resolveReleaseId,
    createChunkId,
    createStableChunkId,
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

// True when a prologue matched by PROLOGUE_REGEX holds a directive, not only a hashbang and comments.
const DIRECTIVE_IN_PROLOGUE_REGEX = /^(?:#![^\n]*\n)?(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*["']/

// Rolldown (Vite 8) minifies after renderChunk, and minification rewrites an injected snippet
// (quoting, variable names, syntax). posthog-cli finds and strips the snippet by exact text so that
// it hashes a chunk without its release id, so in event mode every release would upload unchanged
// chunks again. Under rolldown the snippet therefore goes in after minification: rolldown adds this
// line through `output.postBanner` and shifts the source map by it, and generateBundle swaps it for
// the chunk's snippet. The banner can't carry the snippet itself, because rolldown evaluates it
// before renderChunk derives the chunk id. The line holds no mappings, so the map stays valid.
const SNIPPET_PLACEHOLDER = '/*posthog-chunk-id-snippet*/'

// Rolldown's `output.postBanner`, which Rollup's types don't know.
type RolldownAddon = string | ((chunk: RenderedChunk) => string | Promise<string>)
type RolldownOutputOptions = { postBanner?: RolldownAddon }

async function renderAddon(addon: RolldownAddon | undefined, chunk: RenderedChunk): Promise<string> {
    return (typeof addon === 'function' ? await addon(chunk) : addon) ?? ''
}

function joinAddons(...addons: (string | undefined)[]): string {
    return addons.filter(Boolean).join('\n')
}

export default function posthogRollupPlugin(userOptions: PostHogRollupPluginOptions): Plugin {
    const posthogOptions = resolveConfig(userOptions)
    const eventReleaseMode = posthogOptions.sourcemaps.releaseMode === 'event'

    // Resolved once per build and shared by every output, so all chunks of one build carry the
    // same release. Cleared in buildStart because a watch-mode rebuild can land on a new commit,
    // which is a different release.
    let releaseIdPromise: Promise<string | undefined> | undefined
    let warnedAboutMissingRelease = false
    const chunkIdsByPreliminaryFileName = new Map<string, Set<string>>()

    // Snippets that generateBundle still has to swap in (see SNIPPET_PLACEHOLDER), per rolldown
    // output. Keyed by the postBanner function each output gets, which renderChunk and
    // generateBundle receive back in their output options, so two outputs that render the same
    // file name keep their own snippets.
    const snippetsByOutput = new WeakMap<object, Map<string, string>>()
    // The same snippets by file name across outputs, for augmentChunkHash, which gets no output
    // options. Hashing them keeps file names content hashes: a new release or chunk id renames the
    // file instead of changing its bytes under the same name.
    const deferredSnippetsByPreliminaryFileName = new Map<string, Set<string>>()

    function addToSet(map: Map<string, Set<string>>, key: string, value: string) {
        const values = map.get(key) ?? new Set<string>()
        values.add(value)
        map.set(key, values)
    }

    function rememberChunkId(preliminaryFileName: string, chunkId: string) {
        addToSet(chunkIdsByPreliminaryFileName, preliminaryFileName, chunkId)
    }

    function injectChunkId(code: string, chunkId: string, releaseId?: string) {
        const magicString = new MagicString(code)
        magicString.appendLeft(code.match(PROLOGUE_REGEX)?.[0].length ?? 0, createChunkIdSnippet(chunkId, releaseId))
        magicString.append(createChunkIdComment(chunkId))

        return {
            code: magicString.toString(),
            map: magicString.generateMap({ hires: 'boundary' }),
        }
    }

    const plugin: PostHogRollupPlugin = {
        name: 'posthog-rollup-plugin',

        buildStart() {
            releaseIdPromise = undefined
            warnedAboutMissingRelease = false
            chunkIdsByPreliminaryFileName.clear()
            deferredSnippetsByPreliminaryFileName.clear()
        },

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

                const withSourcemaps = {
                    ...options,
                    sourcemap: posthogOptions.sourcemaps.deleteAfterUpload ? 'hidden' : true,
                } as const
                if (!(this?.meta as { rolldownVersion?: string } | undefined)?.rolldownVersion) return withSourcemaps

                // The user's own postBanner comes first, so a directive or hashbang in it still
                // leads the chunk.
                const { postBanner } = options as RolldownOutputOptions
                const outputPostBanner = async (chunk: RenderedChunk) =>
                    joinAddons(
                        await renderAddon(postBanner, chunk),
                        JS_CHUNK_REGEX.test(chunk.fileName) ? SNIPPET_PLACEHOLDER : undefined
                    )
                snippetsByOutput.set(outputPostBanner, new Map())
                return { ...withSourcemaps, postBanner: outputPostBanner }
            },
        },

        // Chunk ids are injected in-memory, before rollup writes the files and
        // before `generateBundle` — where SRI plugins (e.g. vite-plugin-sri3)
        // compute integrity hashes and rollup resolves [hash] file names. The
        // written files are final; nothing may rewrite them afterwards. Under
        // rolldown the snippet lands at the start of generateBundle instead (see
        // SNIPPET_PLACEHOLDER), still ahead of SRI plugins and already counted
        // in the file name hash by augmentChunkHash.
        renderChunk: {
            order: 'post',
            handler(code: string, chunk: RenderedChunk, outputOptions?: NormalizedOutputOptions) {
                if (!posthogOptions.sourcemaps.enabled) return null
                if (!JS_CHUNK_REGEX.test(chunk.fileName)) return null
                // Already carries an id (watch-mode re-render, another tool)
                const existingChunkId = determineChunkIdFromSource(code)
                if (existingChunkId) {
                    rememberChunkId(chunk.fileName, existingChunkId)
                    if (eventReleaseMode) {
                        console.warn(
                            `PostHog: ${chunk.fileName} already carries a chunk id, so no release id was injected — its exceptions will report no release`
                        )
                    }
                    return null
                }

                // Under rolldown the snippet goes in after minification (see SNIPPET_PLACEHOLDER).
                // Rolldown lifts a hashbang above the placeholder line, but a directive would end up
                // below the snippet and stop being a directive, so a chunk that has one keeps the
                // snippet inside its code, where the minifier may still rewrite it.
                const postBanner = (outputOptions as RolldownOutputOptions | undefined)?.postBanner
                const outputSnippets = typeof postBanner === 'function' ? snippetsByOutput.get(postBanner) : undefined
                const deferredSnippets =
                    outputSnippets && !DIRECTIVE_IN_PROLOGUE_REGEX.test(code.match(PROLOGUE_REGEX)?.[0] ?? '')
                        ? outputSnippets
                        : undefined
                const inject = (chunkId: string, releaseId?: string) => {
                    if (!deferredSnippets) return injectChunkId(code, chunkId, releaseId)
                    const snippet = createChunkIdSnippet(chunkId, releaseId)
                    deferredSnippets.set(chunk.fileName, snippet)
                    addToSet(deferredSnippetsByPreliminaryFileName, chunk.fileName, snippet)
                    return null
                }

                if (!eventReleaseMode) {
                    const chunkId = createChunkId()
                    rememberChunkId(chunk.fileName, chunkId)
                    return inject(chunkId)
                }

                // Event mode carries the release inside the chunk, which means resolving it before
                // the snippet is built. The id is content-addressed so an unchanged chunk keeps its
                // id (and its symbol set) across rebuilds. A chunk that gets its snippet after
                // minification starts with the placeholder line, so the id covers that line too.
                // Its layout differs from the same code with the snippet inside, and a shared id
                // would let one layout's upload overwrite the other's symbol set.
                releaseIdPromise ??= resolveReleaseId(posthogOptions)
                const chunkId = createStableChunkId(deferredSnippets ? `${SNIPPET_PLACEHOLDER}\n${code}` : code)
                rememberChunkId(chunk.fileName, chunkId)
                return releaseIdPromise.then((releaseId) => {
                    // A build that identifies no release still symbolicates from its chunk ids, so
                    // this warns rather than failing, matching what posthog-cli does in the same
                    // situation.
                    if (!releaseId && !warnedAboutMissingRelease) {
                        warnedAboutMissingRelease = true
                        console.warn(
                            '[posthog-rollup-plugin] no release could be resolved, injecting chunk ids only, so exceptions from this build will report no release. Set sourcemaps.releaseName and sourcemaps.releaseVersion, or build from a git repository or a supported CI environment.'
                        )
                    }
                    return inject(chunkId, releaseId)
                })
            },
        },

        augmentChunkHash(chunk: RenderedChunk) {
            const snippets = deferredSnippetsByPreliminaryFileName.get(chunk.fileName)
            return snippets && Array.from(snippets).sort().join('\n')
        },

        // Swaps each placeholder line for its chunk's snippet, or for nothing when the chunk kept
        // its snippet in code. Then restores the CLI-facing comment, which Vite 8's Oxc output
        // minifier removes and which the snippet itself doesn't carry. preliminaryFileName links the
        // final OutputChunk back to its RenderedChunk even when Rollup replaces a [hash] placeholder.
        // Matching against the tracked id avoids treating unrelated bundled `_posthogChunkIds`
        // strings as injected chunks.
        generateBundle: {
            order: 'pre',
            handler(options, bundle) {
                const postBanner = (options as RolldownOutputOptions).postBanner
                const outputSnippets = typeof postBanner === 'function' ? snippetsByOutput.get(postBanner) : undefined
                for (const chunk of Object.values(bundle)) {
                    if (chunk.type !== 'chunk' || !JS_CHUNK_REGEX.test(chunk.fileName)) continue
                    if (outputSnippets) {
                        const snippet = outputSnippets.get(chunk.preliminaryFileName) ?? ''
                        chunk.code = chunk.code.replace(SNIPPET_PLACEHOLDER, () => snippet)
                    }
                    if (determineChunkIdFromSource(chunk.code)) continue

                    const chunkId = Array.from(chunkIdsByPreliminaryFileName.get(chunk.preliminaryFileName) ?? []).find(
                        (candidate) => chunk.code.includes(candidate)
                    )
                    if (chunkId) {
                        // This only appends an unmapped trailing comment, so existing source-map
                        // positions remain valid. `order: pre` also lets SRI plugins hash final code.
                        chunk.code += createChunkIdComment(chunkId)
                    }
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
