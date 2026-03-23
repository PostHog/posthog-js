import {
    PluginConfig as CorePluginConfig,
    ResolvedPluginConfig as CoreResolvedPluginConfig,
    resolveConfig as coreResolveConfig,
    ResolveConfigOptions,
} from '@posthog/core/process'

// Re-export types for backward compatibility — consumers importing from @posthog/webpack-plugin
// will continue to get the same types.
export type PluginConfig = CorePluginConfig
export type ResolvedPluginConfig = CoreResolvedPluginConfig

/**
 * Resolve plugin config with webpack-specific defaults.
 * Webpack defaults sourcemaps.enabled to `process.env.NODE_ENV === 'production'`.
 */
export function resolveConfig(options: PluginConfig, resolveOptions?: ResolveConfigOptions): ResolvedPluginConfig {
    return coreResolveConfig(options, {
        defaultEnabled: process.env.NODE_ENV === 'production',
        cwd: __dirname,
        ...resolveOptions,
    })
}
