import type { NextConfig } from 'next'
import { PosthogWebpackPlugin, PluginConfig, resolveConfig, ResolvedPluginConfig } from '@posthog/webpack-plugin'
import { hasCompilerHook, isTurbopackEnabled, processSourceMaps } from './utils'

type NextFuncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => NextConfig
type NextAsyncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => Promise<NextConfig>
type UserProvidedConfig = NextConfig | NextFuncConfig | NextAsyncConfig

export function withPostHogConfig(userNextConfig: UserProvidedConfig, posthogConfig: PluginConfig): NextConfig {
  const resolvedConfig = resolveConfig(posthogConfig)
  const sourceMapEnabled = resolvedConfig.sourcemaps.enabled
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
      webpack: withWebpackConfig(userWebPackConfig, resolvedConfig),
      compiler: withCompilerConfig(userCompilerConfig, resolvedConfig),
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

function withWebpackConfig(userWebpackConfig: NextConfig['webpack'], posthogConfig: ResolvedPluginConfig) {
  const defaultWebpackConfig = userWebpackConfig || ((config: any) => config)
  const sourceMapEnabled = posthogConfig.sourcemaps.enabled
  return (config: any, options: any) => {
    const turbopackEnabled = isTurbopackEnabled()
    const webpackConfig = defaultWebpackConfig(config, options)
    if (sourceMapEnabled) {
      if (!turbopackEnabled) {
        if (options.isServer) {
          webpackConfig.devtool = 'hidden-source-map'
        }
        webpackConfig.plugins = webpackConfig.plugins || []
        webpackConfig.plugins.push(new PosthogWebpackPlugin(posthogConfig))
      }
    }
    return webpackConfig
  }
}

function withCompilerConfig(
  userCompilerConfig: NextConfig['compiler'],
  posthogConfig: ResolvedPluginConfig
): NextConfig['compiler'] {
  const sourceMapEnabled = posthogConfig.sourcemaps.enabled
  const turbopackEnabled = isTurbopackEnabled()
  if (sourceMapEnabled && turbopackEnabled && hasCompilerHook()) {
    const newConfig = userCompilerConfig || {}
    const userCompilerHook = userCompilerConfig?.runAfterProductionCompile
    newConfig.runAfterProductionCompile = async (config: { distDir: string; projectDir: string }) => {
      await userCompilerHook?.(config)
      console.debug('Processing source maps from compilation hook...')
      await processSourceMaps(posthogConfig, config.distDir)
    }
    return newConfig
  }
  return userCompilerConfig
}
