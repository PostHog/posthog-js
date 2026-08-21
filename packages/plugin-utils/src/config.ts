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

/**
 * How an exception gets associated with a release, mirroring posthog-cli's `--release-mode`.
 *
 * `symbol-set` binds the uploaded symbol sets to a release. `event` leaves them unbound and
 * injects the release id into each chunk instead, so the release is resolved per exception.
 */
export type ReleaseMode = 'symbol-set' | 'event'

const RELEASE_MODES: ReleaseMode[] = ['symbol-set', 'event']

function normalizeReleaseMode(value: string | undefined): ReleaseMode {
    if (value === undefined || value === '') {
        return 'symbol-set'
    }
    if (!(RELEASE_MODES as string[]).includes(value)) {
        throw new Error(`sourcemaps.releaseMode must be one of ${RELEASE_MODES.join(', ')}, got '${value}'`)
    }
    return value as ReleaseMode
}

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
         * EXPERIMENTAL. Defaults to the `POSTHOG_RELEASE_MODE` env var, the same one posthog-cli
         * reads, then to `symbol-set`. Event mode needs a posthog-cli that supports
         * `release resolve` and `--release-mode`.
         */
        releaseMode?: ReleaseMode
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
        releaseMode: ReleaseMode
    }
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
            releaseMode: normalizeReleaseMode(userSourcemaps.releaseMode ?? process.env.POSTHOG_RELEASE_MODE),
        },
    }
}
