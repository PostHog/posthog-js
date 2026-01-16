import { resolveBinaryPath } from '@posthog/core/process'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export interface PluginConfig {
    personalApiKey: string
    envId: string
    host?: string
    logLevel?: LogLevel
    cliBinaryPath?: string
    sourcemaps?: {
        enabled?: boolean
        upload?: boolean
        project?: string
        version?: string
        deleteAfterUpload?: boolean
        batchSize?: number
    }
}

export interface ResolvedPluginConfig extends PluginConfig {
    host: string
    logLevel: LogLevel
    cliBinaryPath: string
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

export function resolveConfig(options: PluginConfig): ResolvedPluginConfig {
    const host = options.host ?? 'https://us.i.posthog.com'
    const logLevel = options.logLevel ?? 'info'
    const cliBinaryPath =
        options.cliBinaryPath ??
        resolveBinaryPath('posthog-cli', {
            path: process.env.PATH ?? '',
            cwd: __dirname,
        })

    const sourcemaps = options.sourcemaps ?? {}

    const resolvedSourcemaps = {
        enabled: sourcemaps.enabled ?? process.env.NODE_ENV === 'production',
        upload: sourcemaps.upload ?? true,
        project: sourcemaps.project,
        version: sourcemaps.version,
    }
    if (resolvedSourcemaps.upload) {
        resolvedSourcemaps.deleteAfterUpload = sourcemaps.deleteAfterUpload ?? true
        resolvedSourcemaps.batchSize = sourcemaps.batchSize
    }

    return {
        personalApiKey: options.personalApiKey,
        envId: options.envId,
        host,
        logLevel,
        cliBinaryPath,
        sourcemaps: resolvedSourcemaps,
    }
}
