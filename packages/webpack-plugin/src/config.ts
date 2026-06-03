import {
    PluginConfig as CorePluginConfig,
    ResolvedPluginConfig as CoreResolvedPluginConfig,
    resolveConfig as coreResolveConfig,
    ResolveConfigOptions,
} from '@posthog/plugin-utils'

// Re-export types for backward compatibility — consumers importing from @posthog/webpack-plugin
// will continue to get the same types.
export type PluginConfig = CorePluginConfig
export type ResolvedPluginConfig = CoreResolvedPluginConfig

/**
 * Resolve plugin config with webpack-specific defaults.
 * Defaults sourcemaps.enabled to `true`, matching the other PostHog bundler plugins.
 */
export function resolveConfig(options: PluginConfig, resolveOptions?: ResolveConfigOptions): ResolvedPluginConfig {
    return coreResolveConfig(options, {
        cwd: __dirname,
        ...resolveOptions,
    })
}
