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
        project?: string
        version?: string
        deleteAfterUpload?: boolean
    }
}

export interface ResolvedPluginConfig extends PluginConfig {
    host: string
    logLevel: LogLevel
    cliBinaryPath: string
    sourcemaps: {
        enabled: boolean
        project?: string
        version?: string
        deleteAfterUpload: boolean
    }
}

export function resolveConfig(options: PluginConfig): ResolvedPluginConfig {
    const host = options.host ?? 'https://us.i.posthog.com'
    const logLevel = options.logLevel ?? 'info'
    const cliBinaryPath =
        options.cliBinaryPath ??
        resolveBinaryPath('posthog-cli', {
            path: process.env.PATH ?? '',
            cwd: process.cwd(),
        })

    const sourcemaps = options.sourcemaps ?? {}

    return {
        personalApiKey: options.personalApiKey,
        envId: options.envId,
        host,
        logLevel,
        cliBinaryPath,
        sourcemaps: {
            enabled: sourcemaps.enabled ?? process.env.NODE_ENV == 'production',
            project: sourcemaps.project,
            version: sourcemaps.version,
            deleteAfterUpload: sourcemaps.deleteAfterUpload ?? true,
        },
    }
}
