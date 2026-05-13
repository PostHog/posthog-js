import type { NextConfig } from 'next'
import { PosthogWebpackPlugin, PluginConfig, resolveConfig, ResolvedPluginConfig } from '@posthog/webpack-plugin'
import { hasCompilerHook, isTurbopackEnabled, processSourceMaps } from './utils'

type NextFuncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => NextConfig
type NextAsyncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => Promise<NextConfig>
type UserProvidedConfig = NextConfig | NextFuncConfig | NextAsyncConfig

let invocationTrackingRegistered = false
let innerConfigInvoked = false

function registerInvocationCheck(): void {
  if (invocationTrackingRegistered) {
    return
  }
  invocationTrackingRegistered = true
  process.on('exit', () => {
    if (!innerConfigInvoked) {
      console.warn(
        '[@posthog/nextjs-config] withPostHogConfig was called, but its inner Next.js config function was never invoked. ' +
          'This usually means another Next.js config wrapper (e.g. withNextIntl, withMDX) is being applied around withPostHogConfig ' +
          'and is not forwarding the function-form config that withPostHogConfig returns. ' +
          'As a result, no source maps were generated or uploaded. ' +
          'Fix: make withPostHogConfig the OUTERMOST wrapper, e.g. ' +
          '`export default withPostHogConfig(withNextIntl(nextConfig), { ... })`.'
      )
    }
  })
}

export function withPostHogConfig(userNextConfig: UserProvidedConfig, posthogConfig: PluginConfig): NextConfig {
  const resolvedConfig = resolveConfig(posthogConfig)
  const sourceMapEnabled = resolvedConfig.sourcemaps.enabled
  const isCompilerHookSupported = hasCompilerHook()
  const turbopackEnabled = isTurbopackEnabled()
  if (turbopackEnabled && !isCompilerHookSupported) {
    console.warn('[@posthog/nextjs-config] Turbopack support is only available with next version >= 15.4.1')
  }
  if (sourceMapEnabled) {
    registerInvocationCheck()
  }
  return async (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
    innerConfigInvoked = true
    const {
      webpack: userWebPackConfig,
      compiler: userCompilerConfig,
      distDir,
      ...userConfig
    } = await resolveUserConfig(userNextConfig, phase, defaultConfig)
    const nextConfig = {
      ...userConfig,
      distDir,
      webpack: withWebpackConfig(userWebPackConfig, resolvedConfig),
      compiler: withCompilerConfig(userCompilerConfig, resolvedConfig),
    }
    if (turbopackEnabled && sourceMapEnabled) {
      nextConfig.productionBrowserSourceMaps = true
    }
    return nextConfig
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
  const turbopackEnabled = isTurbopackEnabled()
  return (config: any, options: any) => {
    const webpackConfig = defaultWebpackConfig(config, options)
    const isServer = options.isServer
    if (sourceMapEnabled) {
      if (!turbopackEnabled) {
        webpackConfig.plugins = webpackConfig.plugins || []
        let currentConfig = posthogConfig
        if (isServer) {
          currentConfig = {
            ...posthogConfig,
            sourcemaps: {
              ...posthogConfig.sourcemaps,
              deleteAfterUpload: false,
            },
          }
        }
        webpackConfig.plugins.push(new PosthogWebpackPlugin(currentConfig, true))
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
