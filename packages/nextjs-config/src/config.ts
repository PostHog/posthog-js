import type { NextConfig } from 'next'
import { SourcemapWebpackPlugin } from './webpack-plugin'

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
  }
}

export function withPostHogConfig(userNextConfig: UserProvidedConfig, posthogConfig: PostHogNextConfig): NextConfig {
  const posthogNextConfigComplete = resolvePostHogConfig(posthogConfig)
  return async (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
    const { webpack: userWebPackConfig, ...userConfig } = await resolveUserConfig(userNextConfig, phase, defaultConfig)
    const defaultWebpackConfig = userWebPackConfig || ((config: any) => config)
    const sourceMapEnabled = posthogNextConfigComplete.sourcemaps.enabled
    return {
      ...userConfig,
      productionBrowserSourceMaps: sourceMapEnabled,
      webpack: (config: any, options: any) => {
        const webpackConfig = defaultWebpackConfig(config, options)
        if (webpackConfig && options.isServer && sourceMapEnabled) {
          webpackConfig.devtool = 'source-map'
        }
        if (sourceMapEnabled) {
          webpackConfig.plugins = webpackConfig.plugins || []
          webpackConfig.plugins.push(
            new SourcemapWebpackPlugin(posthogNextConfigComplete, options.isServer, options.nextRuntime)
          )
        }
        return webpackConfig
      },
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
    },
  }
}
