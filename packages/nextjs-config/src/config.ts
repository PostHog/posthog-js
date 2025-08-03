import type { NextConfig } from 'next'
import { SourcemapWebpackPlugin } from './webpack-plugin'
import { processTurbopackSourcemaps } from './turbopack-handler'

type NextFuncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => NextConfig
type NextAsyncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => Promise<NextConfig>
type UserProvidedConfig = NextConfig | NextFuncConfig | NextAsyncConfig

export type PostHogNextConfig = {
  personalApiKey: string
  envId: string
  host?: string
  verbose?: boolean
  sourcemaps?: {
    enabled?: boolean
    project?: string
    version?: string
    deleteAfterUpload?: boolean
    failOnError?: boolean
  }
}

export type PostHogNextConfigComplete = {
  personalApiKey: string
  envId: string
  host: string
  verbose: boolean
  sourcemaps: {
    enabled: boolean
    project?: string
    version?: string
    deleteAfterUpload: boolean
    failOnError: boolean
  }
}

export function withPostHogConfig(userNextConfig: UserProvidedConfig, posthogConfig: PostHogNextConfig): NextConfig {
  const posthogNextConfigComplete = resolvePostHogConfig(posthogConfig)
  return async (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
    const resolvedUserConfig = await resolveUserConfig(userNextConfig, phase, defaultConfig)
    const sourceMapEnabled = posthogNextConfigComplete.sourcemaps.enabled

    // Check if Turbopack is being used
    // Turbopack can be enabled via:
    // 1. --turbo flag in CLI (sets TURBOPACK env var)
    // 2. experimental.turbo in config (Next.js 13+)
    // 3. turbo: true in config (Next.js 14+)
    const isTurbopack = isTurbopackEnabled(resolvedUserConfig)

    if (isTurbopack) {
      // For Turbopack, use Next.js build hooks to process sourcemaps after build
      return {
        ...resolvedUserConfig,
        productionBrowserSourceMaps: sourceMapEnabled,
        ...(sourceMapEnabled && process.env.NODE_ENV === 'production'
          ? {
              runAfterProductionCompile: async () => {
                // Call user's hook first if it exists
                if (resolvedUserConfig.runAfterProductionCompile) {
                  await resolvedUserConfig.runAfterProductionCompile()
                }
                // Then process sourcemaps
                await processTurbopackSourcemaps(posthogNextConfigComplete, resolvedUserConfig.distDir)
              },
            }
          : {}),
      }
    } else {
      // For Webpack, add our plugin to the webpack config
      const { webpack: userWebpackConfig, ...configWithoutWebpack } = resolvedUserConfig

      return {
        ...configWithoutWebpack,
        productionBrowserSourceMaps: sourceMapEnabled,
        webpack: (config: any, options: any) => {
          // Call user's webpack config if they have one, otherwise just pass through
          const webpackConfig = userWebpackConfig ? userWebpackConfig(config, options) : config

          if (sourceMapEnabled) {
            if (webpackConfig && options.isServer) {
              webpackConfig.devtool = 'source-map'
            }
            webpackConfig.plugins = webpackConfig.plugins || []
            webpackConfig.plugins.push(
              new SourcemapWebpackPlugin(
                posthogNextConfigComplete,
                options.isServer,
                options.nextRuntime,
                resolvedUserConfig.distDir
              )
            )
          }

          return webpackConfig
        },
      }
    }
  }
}

function resolveUserConfig(
  userNextConfig: UserProvidedConfig,
  phase: string,
  defaultConfig: NextConfig
): Promise<NextConfig> {
  if (typeof userNextConfig === 'function') {
    const maybePromise = userNextConfig(phase, { defaultConfig })
    if (maybePromise instanceof Promise) {
      return maybePromise
    } else {
      return Promise.resolve(maybePromise)
    }
  } else if (typeof userNextConfig === 'object') {
    return Promise.resolve(userNextConfig)
  } else {
    throw new Error('Invalid user config')
  }
}

function resolvePostHogConfig(posthogProvidedConfig: PostHogNextConfig): PostHogNextConfigComplete {
  const { personalApiKey, envId, host, verbose, sourcemaps = {} } = posthogProvidedConfig

  // Validate required configuration
  if (!personalApiKey) {
    throw new Error('PostHog: Personal API key not provided. Please set personalApiKey in your PostHog config.')
  }
  if (!envId) {
    throw new Error('PostHog: Environment ID not provided. Please set envId in your PostHog config.')
  }

  return {
    personalApiKey,
    envId,
    host: host ?? 'https://us.posthog.com',
    verbose: verbose ?? true,
    sourcemaps: {
      enabled: sourcemaps.enabled ?? process.env.NODE_ENV == 'production',
      project: sourcemaps.project,
      version: sourcemaps.version,
      deleteAfterUpload: sourcemaps.deleteAfterUpload ?? true,
      failOnError: sourcemaps.failOnError ?? false,
    },
  }
}

// Helper to detect if Turbopack is enabled
function isTurbopackEnabled(resolvedUserConfig: NextConfig): boolean {
  return (
    // CLI flag (--turbo/--turbopack) injects TURBOPACK=1 at runtime
    process.env.TURBOPACK === '1' ||
    // Next.js 13+ experimental config: { experimental: { turbo: true } }
    (resolvedUserConfig.experimental as any)?.turbo ||
    // Next.js 14+ stable config: { turbo: true }
    (resolvedUserConfig as any).turbo === true
  )
}
