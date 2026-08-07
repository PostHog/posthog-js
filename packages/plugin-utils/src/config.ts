import { resolveBinaryPath } from './utils'

const DEFAULT_PLUGIN_HOST = 'https://us.i.posthog.com'

function normalizeApiKey(value?: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeHost(value?: unknown): string {
    const normalizedHost = typeof value === 'string' ? value.trim() : ''
    return normalizedHost || DEFAULT_PLUGIN_HOST
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

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
        build?: string | number
        deleteAfterUpload?: boolean
        batchSize?: number
        /**
         * EXPERIMENTAL: don't bind uploaded symbol sets to a release; chunk ids become stable
         * across rebuilds. Requires a posthog-cli that supports `--no-release-bind`.
         * Defaults to the POSTHOG_NO_RELEASE_BIND env var.
         */
        noReleaseBind?: boolean
    }
}

export interface ResolvedPluginConfig extends Omit<PluginConfig, 'envId' | 'projectId'> {
    projectId?: string
    host: string
    logLevel: LogLevel
    cliBinaryPath: string
    sourcemaps: {
        enabled: boolean
        releaseName?: string
        releaseVersion?: string
        build?: string
        deleteAfterUpload: boolean
        batchSize?: number
        noReleaseBind: boolean
    }
}

/** Mirrors the CLI's boolish env parsing. */
function boolishEnv(value: string | undefined): boolean {
    if (value === undefined) {
        return false
    }
    return !['false', 'f', 'no', 'n', 'off', '0', ''].includes(value.trim().toLowerCase())
}

export interface ResolveConfigOptions {
    /** Default value for sourcemaps.enabled when not explicitly set. Defaults to true. */
    defaultEnabled?: boolean
    /** The cwd used for resolving the CLI binary path. Defaults to process.cwd(). */
    cwd?: string
}

export function resolveConfig(options: PluginConfig, resolveOptions?: ResolveConfigOptions): ResolvedPluginConfig {
    const projectId = options.projectId ?? options.envId
    const personalApiKey = normalizeApiKey(options.personalApiKey)
    const host = normalizeHost(options.host)
    const logLevel = options.logLevel ?? 'info'
    const cwd = resolveOptions?.cwd ?? process.cwd()
    const cliBinaryPath =
        options.cliBinaryPath ??
        resolveBinaryPath('posthog-cli', {
            path: process.env.PATH ?? '',
            cwd,
        })

    const userSourcemaps = options.sourcemaps ?? {}
    const defaultEnabled = resolveOptions?.defaultEnabled ?? true
    const enabled = userSourcemaps.enabled ?? defaultEnabled

    if (enabled) {
        if (!projectId) {
            throw new Error('projectId is required when sourcemaps are enabled (envId is deprecated)')
        }
        if (!personalApiKey) {
            throw new Error('personalApiKey is required when sourcemaps are enabled')
        }
    }

    return {
        personalApiKey,
        projectId,
        host,
        logLevel,
        cliBinaryPath,
        sourcemaps: {
            enabled,
            releaseName: userSourcemaps.releaseName ?? userSourcemaps.project,
            releaseVersion: userSourcemaps.releaseVersion ?? userSourcemaps.version,
            build: userSourcemaps.build !== undefined ? String(userSourcemaps.build) : undefined,
            deleteAfterUpload: userSourcemaps.deleteAfterUpload ?? true,
            batchSize: userSourcemaps.batchSize,
            noReleaseBind: userSourcemaps.noReleaseBind ?? boolishEnv(process.env.POSTHOG_NO_RELEASE_BIND),
        },
    }
}
