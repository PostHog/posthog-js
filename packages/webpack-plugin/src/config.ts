import { resolveBinaryPath } from '@posthog/core/process'

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export interface PluginConfig {
    personalApiKey: string
    /** @deprecated Use projectId instead */
    envId?: string
    projectId?: string
    host?: string
    logLevel?: LogLevel
    cliBinaryPath?: string
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

export interface ResolvedPluginConfig extends Omit<PluginConfig, 'envId' | 'projectId'> {
    projectId: string
    host: string
    logLevel: LogLevel
    cliBinaryPath: string
    sourcemaps: {
        enabled: boolean
        releaseName?: string
        releaseVersion?: string
        deleteAfterUpload: boolean
        batchSize?: number
    }
}

export function resolveConfig(options: PluginConfig): ResolvedPluginConfig {
    const projectId = options.projectId ?? options.envId
    if (!projectId) {
        throw new Error('projectId is required (envId is deprecated)')
    }

    const host = options.host ?? 'https://us.i.posthog.com'
    const logLevel = options.logLevel ?? 'info'
    const cliBinaryPath =
        options.cliBinaryPath ??
        resolveBinaryPath('posthog-cli', {
            path: process.env.PATH ?? '',
            cwd: __dirname,
        })

    const sourcemaps = options.sourcemaps ?? {}

    return {
        personalApiKey: options.personalApiKey,
        projectId,
        host,
        logLevel,
        cliBinaryPath,
        sourcemaps: {
            enabled: sourcemaps.enabled ?? process.env.NODE_ENV === 'production',
            releaseName: sourcemaps.releaseName ?? sourcemaps.project,
            releaseVersion: sourcemaps.releaseVersion ?? sourcemaps.version,
            deleteAfterUpload: sourcemaps.deleteAfterUpload ?? true,
            batchSize: sourcemaps.batchSize,
        },
    }
}
