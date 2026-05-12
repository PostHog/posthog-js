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

  // `withPostHogConfig` returns an async function that Next.js calls during
  // build init. If a downstream config wrapper (e.g. `withNextIntl`) consumes
  // this function and produces its own plain-object config without delegating,
  // our webpack/compiler hooks never run and source maps silently fail to
  // upload. Detect that by checking on the next tick whether Next.js (or any
  // outer wrapper) actually invoked our returned function. If not, warn so the
  // user knows to move `withPostHogConfig` to be the outermost wrapper.
  // See https://github.com/PostHog/posthog-js/issues/3572
  let invoked = false
  const nextConfigFn = async (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
    invoked = true
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

  if (typeof setTimeout === 'function') {
    const timer = setTimeout(() => {
      if (!invoked) {
        console.warn(
          '[@posthog/nextjs-config] withPostHogConfig was loaded but Next.js never invoked the config function it returns. ' +
            'This usually means another config wrapper (e.g. withNextIntl, withSentryConfig) is wrapping withPostHogConfig ' +
            'and producing a plain object that drops the PostHog hooks. Move withPostHogConfig(...) to be the OUTERMOST ' +
            'wrapper in next.config.js so source maps upload and other build hooks run. ' +
            'See https://github.com/PostHog/posthog-js/issues/3572'
        )
      }
    }, 5000)
    // Allow the Node process to exit normally even if our timer is pending.
    if (typeof timer === 'object' && timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }
  }

  return nextConfigFn
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
