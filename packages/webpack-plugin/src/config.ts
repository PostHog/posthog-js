import {
    PluginConfig as CorePluginConfig,
    ResolvedPluginConfig as CoreResolvedPluginConfig,
    resolveConfig as coreResolveConfig,
    ResolveConfigOptions,
} from '@posthog/plugin-utils'

export type PluginConfig = CorePluginConfig & {
    sourcemaps?: CorePluginConfig['sourcemaps'] & {
        /**
         * Fail the build when PostHog cannot process or upload the sourcemaps, for example because the
         * personal API key is invalid. Defaults to `true`; set it to `false` to log the error and continue the build.
         * Watch builds (`webpack --watch`, dev servers, `next dev`) always log the error and keep running.
         * In `@posthog/nextjs-config` this applies to webpack builds; Turbopack builds fail on these errors either way.
         */
        failOnError?: boolean
    }
}

export type ResolvedPluginConfig = CoreResolvedPluginConfig & {
    sourcemaps: CoreResolvedPluginConfig['sourcemaps'] & { failOnError?: boolean }
}

/**
 * Resolve plugin config with webpack-specific defaults.
 * Defaults sourcemaps.enabled to `true`, matching the other PostHog bundler plugins.
 */
export function resolveConfig(options: PluginConfig, resolveOptions?: ResolveConfigOptions): ResolvedPluginConfig {
    const resolved = coreResolveConfig(options, {
        cwd: __dirname,
        ...resolveOptions,
    })
    return {
        ...resolved,
        sourcemaps: { ...resolved.sourcemaps, failOnError: options.sourcemaps?.failOnError ?? true },
    }
}
