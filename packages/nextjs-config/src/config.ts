import type { NextConfig } from 'next'
import { SourcemapWebpackPlugin } from './webpack-plugin'
import { hasCompilerHook, isTurbopackEnabled, processSourceMaps } from './utils'

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
  const sourceMapEnabled = posthogNextConfigComplete.sourcemaps.enabled
  const isCompilerHookSupported = hasCompilerHook()
  const turbopackEnabled = isTurbopackEnabled()
  if (turbopackEnabled && !isCompilerHookSupported) {
    console.warn('[@posthog/nextjs-config] Turbopack support is only available with next version >= 15.4.1')
  }
  return async (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
    const {
      webpack: userWebPackConfig,
      compiler: userCompilerConfig,
      distDir,
      ...userConfig
    } = await resolveUserConfig(userNextConfig, phase, defaultConfig)
    return {
      ...userConfig,
      distDir,
      productionBrowserSourceMaps: sourceMapEnabled,
      webpack: withWebpackConfig(
        userWebPackConfig,
        sourceMapEnabled,
        !isCompilerHookSupported,
        posthogNextConfigComplete,
        distDir
      ),
      compiler: withCompilerConfig(userCompilerConfig, sourceMapEnabled, posthogNextConfigComplete),
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

function withWebpackConfig(
  userWebpackConfig: NextConfig['webpack'],
  sourceMapEnabled: boolean,
  injectPlugin: boolean,
  posthogConfig: PostHogNextConfigComplete,
  distDir: string | undefined
) {
  const defaultWebpackConfig = userWebpackConfig || ((config: any) => config)
  return (config: any, options: any) => {
    const webpackConfig = defaultWebpackConfig(config, options)
    if (webpackConfig && options.isServer && sourceMapEnabled) {
      webpackConfig.devtool = 'source-map'
    }
    if (sourceMapEnabled && injectPlugin) {
      webpackConfig.plugins = webpackConfig.plugins || []
      webpackConfig.plugins.push(
        new SourcemapWebpackPlugin(posthogConfig, options.isServer, options.nextRuntime, distDir)
      )
    }
    return webpackConfig
  }
}

function withCompilerConfig(
  userCompilerConfig: NextConfig['compiler'],
  sourceMapEnabled: boolean,
  posthogConfig: PostHogNextConfigComplete
): NextConfig['compiler'] {
  const newConfig = userCompilerConfig || {}
  if (sourceMapEnabled && hasCompilerHook()) {
    const userCompilerHook = userCompilerConfig?.runAfterProductionCompile
    newConfig.runAfterProductionCompile = async (config: { distDir: string; projectDir: string }) => {
      await userCompilerHook?.(config)
      posthogConfig.verbose && console.debug('Processing source maps from compilation hook...')
      await processSourceMaps(posthogConfig, config.distDir)
    }
  }
  return newConfig
}
