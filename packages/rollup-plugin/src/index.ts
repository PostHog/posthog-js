import MagicString from 'magic-string'
import { v5 as uuidv5 } from 'uuid'
import type { Plugin, OutputOptions, OutputAsset, OutputChunk } from 'rollup'
import crypto from 'node:crypto'
import { spawnLocal, resolveBinaryPath, LogLevel } from '@posthog/core/process'
import path from 'node:path'

export type PostHogRollupPluginOptions = {
    personalApiKey: string
    envId: string
    host?: string
    cliBinaryPath?: string
    logLevel?: LogLevel
    sourcemaps: {
        enabled?: boolean
        project?: string
        version?: string
        deleteAfterUpload?: boolean
    }
}

export default function posthogRollupPlugin(userOptions: PostHogRollupPluginOptions) {
    const posthogOptions = resolveOptions(userOptions)
    return {
        name: 'posthog-inject-chunk-ids',
        outputOptions: {
            order: 'post',
            handler(options) {
                return {
                    ...options,
                    sourcemap: true,
                }
            },
        },
        renderChunk(code, chunk) {
            if (isJavascriptFile(chunk.fileName)) {
                const chunkId = generateChunkId(code)
                const codeToInject = getChunkIdSnippet(chunkId)
                const magicCode = new MagicString(code)
                // TODO: Inject after use directives
                magicCode.prepend(codeToInject)
                magicCode.append(`\n//# chunkId=${chunkId}\n`)
                return {
                    code: magicCode.toString(),
                    map: magicCode.generateMap({ file: chunk.fileName, hires: 'boundary' }),
                }
            } else {
                return null
            }
        },
        async writeBundle(options: OutputOptions, bundle: { [fileName: string]: OutputAsset | OutputChunk }) {
            const args = ['sourcemap', 'upload']
            const cliPath = posthogOptions.cliBinaryPath
            if (options.dir) {
                const directory = path.resolve(options.dir)
                args.push('--directory', directory)
                for (const chunk of Object.values(bundle)) {
                    if (chunk.type === 'chunk') {
                        args.push('--include', chunk.fileName)
                    }
                }
            } else if (options.file) {
                const filePath = path.resolve(options.file)
                const parentDirectory = path.dirname(filePath)
                args.push('--directory', parentDirectory)
                args.push('--include', filePath)
            }
            if (posthogOptions.sourcemaps.deleteAfterUpload) {
                args.push('--delete-after')
            }
            await spawnLocal(cliPath, args, {
                env: {
                    ...process.env,
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

function isJavascriptFile(fileName: string) {
    return ['.js', '.mjs', '.cjs'].some((ext) => fileName.endsWith(ext))
}

function getChunkIdSnippet(chunkId: string) {
    return `;!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="${chunkId}")}catch(e){}}();\n`
}

const debugIdNamespace = '4ed1c858-f40e-4b92-b3ff-541d185bb87f'
function generateChunkId(code: string) {
    const hash = crypto.createHash('sha256').update(code).digest('hex')
    return uuidv5(hash, debugIdNamespace)
}

type ResolvedPostHogRollupPluginOptions = {
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
