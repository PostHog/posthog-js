import type { OutputFile, Plugin } from 'esbuild'
import path from 'node:path'

const JAVASCRIPT_OUTPUT = /\.(?:c|m)?js$/i
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// The output filename is already content-hashed by Angular/esbuild and is available at runtime
// through import.meta.url. Using it as the chunk id lets the same banner run in every chunk before
// esbuild computes output hashes. posthog-cli reads the matching id from the sourcemap metadata.
const RUNTIME_CHUNK_ID_BANNER =
    '!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack,r=decodeURIComponent(import.meta.url.split(/[?#]/)[0].split("/").pop()||"");n&&r&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]=r)}catch(e){}}();/* posthog-chunk-id: output-filename */'

export interface PostHogEsbuildPluginOptions {
    /** Disable injection without changing the Angular builder configuration. */
    enabled?: boolean
}

type JsonSourceMap = Record<string, unknown> & {
    version: number
    sources: string[]
    names: string[]
    mappings: string
    chunk_id?: string
}

/**
 * Register content-hashed output filenames as PostHog chunk IDs before esbuild hashes the bundle.
 *
 * This plugin intentionally does not upload source maps. Build systems such as Angular still need
 * to create manifests and write these outputs after esbuild completes. Run
 * `posthog-cli sourcemap upload` once the files are on disk.
 */
export default function posthogEsbuildPlugin(options: PostHogEsbuildPluginOptions = {}): Plugin {
    return {
        name: 'posthog-esbuild-plugin',
        setup(build) {
            if (options.enabled === false) {
                return
            }

            const existingBanner = build.initialOptions.banner?.js
            build.initialOptions.banner = {
                ...build.initialOptions.banner,
                js: existingBanner?.includes(RUNTIME_CHUNK_ID_BANNER)
                    ? existingBanner
                    : existingBanner
                      ? `${existingBanner}\n${RUNTIME_CHUNK_ID_BANNER}`
                      : RUNTIME_CHUNK_ID_BANNER,
            }

            build.onEnd((result) => {
                if (result.errors.length > 0) {
                    return
                }
                if (!result.outputFiles) {
                    throw new Error(
                        '[posthog-esbuild-plugin] esbuild did not expose in-memory output files. ' +
                            'This integration requires write:false. Angular application builders already use write:false.'
                    )
                }

                stampChunkIds(result.outputFiles)
            })
        },
    }
}

/** Exported for build-integration tests and custom builder authors. */
export function stampChunkIds(outputFiles: OutputFile[]): void {
    const filesByPath = new Map(outputFiles.map((file) => [path.resolve(file.path), file]))

    for (const sourceFile of outputFiles) {
        if (!JAVASCRIPT_OUTPUT.test(sourceFile.path)) {
            continue
        }

        const sourceMapFile = filesByPath.get(path.resolve(`${sourceFile.path}.map`))
        if (!sourceMapFile) {
            throw new Error(
                `[posthog-esbuild-plugin] no external sourcemap output was found for ${sourceFile.path}. ` +
                    'Enable JavaScript source maps for this build.'
            )
        }

        const sourceMap = parseSourceMap(sourceMapFile)
        sourceMap.chunk_id = path.basename(sourceFile.path)
        sourceMapFile.contents = encoder.encode(JSON.stringify(sourceMap))
    }
}

function parseSourceMap(file: OutputFile): JsonSourceMap {
    try {
        const sourceMap = JSON.parse(decoder.decode(file.contents)) as JsonSourceMap
        if (
            sourceMap.version !== 3 ||
            !(sourceMap.sources instanceof Array) ||
            !(sourceMap.names instanceof Array) ||
            typeof sourceMap.mappings !== 'string'
        ) {
            throw new Error('expected a version 3 sourcemap')
        }
        return sourceMap
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[posthog-esbuild-plugin] failed to parse ${file.path}: ${message}`)
    }
}
