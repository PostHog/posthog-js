import type { NextConfig } from 'next'
import { PosthogWebpackPlugin, PluginConfig, resolveConfig, ResolvedPluginConfig } from '@posthog/webpack-plugin'
import * as utils from './utils'
import { deleteSourceMapFiles, stripDanglingSourceMapComments } from './strip-sourcemap-comments'

type NextFuncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => NextConfig
type NextAsyncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => Promise<NextConfig>
type UserProvidedConfig = NextConfig | NextFuncConfig | NextAsyncConfig
type TurbopackConfigWithDebugIds = NonNullable<NextConfig['turbopack']> & { debugIds: boolean }

// How long after `withPostHogConfig` returns we wait before deciding that
// Next.js (or an outer wrapper) never invoked our config function. See the
// comment inside `withPostHogConfig` for the full reasoning.
const INVOCATION_TIMEOUT_MS = 5000

export function withPostHogConfig(userNextConfig: UserProvidedConfig, posthogConfig: PluginConfig): NextConfig {
  const resolvedConfig = resolveConfig(posthogConfig)
  const sourceMapEnabled = resolvedConfig.sourcemaps.enabled
  const isCompilerHookSupported = utils.hasCompilerHook()
  const turbopackEnabled = utils.isTurbopackEnabled()
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
  //
  // Known false-positive: if `next.config.js` is imported outside the Next.js
  // build pipeline (e.g. a Jest/Vitest test that imports the config for
  // assertions, or a custom script that reads it directly), `nextConfigFn` is
  // never invoked and this warning will fire after the timeout. That's
  // acceptable here — the warning is informational, not fatal — and the
  // alternative (an opt-out flag) adds API surface for an edge case.
  // See https://github.com/PostHog/posthog-js/issues/3572
  let invoked = false
  let releaseIdPromise: Promise<string | undefined> | undefined
  const nextConfigFn = async (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
    invoked = true
    const {
      webpack: userWebPackConfig,
      compiler: userCompilerConfig,
      turbopack: userTurbopackConfig,
      env: userEnv,
      distDir,
      ...userConfig
    } = await resolveUserConfig(userNextConfig, phase, defaultConfig)
    const nativeDebugIdsEnabled =
      turbopackEnabled &&
      sourceMapEnabled &&
      resolvedConfig.sourcemaps.releaseMode === 'event' &&
      utils.supportsTurbopackDebugIds()
    let releaseId =
      normalizeReleaseId(userEnv?.POSTHOG_RELEASE_ID) ?? normalizeReleaseId(process.env.POSTHOG_RELEASE_ID)
    if (!releaseId && nativeDebugIdsEnabled && phase === 'phase-production-build') {
      releaseIdPromise ??= utils.resolveReleaseId(resolvedConfig)
      releaseId = await releaseIdPromise
    }
    const nextConfig: NextConfig = {
      ...userConfig,
      ...(userTurbopackConfig ? { turbopack: userTurbopackConfig } : {}),
      ...(userEnv ? { env: userEnv } : {}),
      distDir,
      webpack: withWebpackConfig(userWebPackConfig, resolvedConfig),
      compiler: withCompilerConfig(userCompilerConfig, resolvedConfig, nativeDebugIdsEnabled),
    }
    if (nativeDebugIdsEnabled) {
      const turbopackConfig: TurbopackConfigWithDebugIds = { ...userTurbopackConfig, debugIds: true }
      nextConfig.turbopack = turbopackConfig
      if (releaseId) {
        nextConfig.env = { ...userEnv, POSTHOG_RELEASE_ID: releaseId }
      }
    }
    if (turbopackEnabled && sourceMapEnabled) {
      nextConfig.productionBrowserSourceMaps = true
    } else if (sourceMapEnabled && resolvedConfig.sourcemaps.deleteAfterUpload) {
      // Next.js traces server source maps before the webpack plugin deletes them. Exclude the maps
      // from the trace so standalone/Vercel packaging does not try to copy the deleted files.
      nextConfig.outputFileTracingExcludes = {
        ...userConfig.outputFileTracingExcludes,
        '*': [...(userConfig.outputFileTracingExcludes?.['*'] ?? []), `${distDir ?? '.next'}/server/**/*.map`],
      }
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
    }, INVOCATION_TIMEOUT_MS)
    // Allow the Node process to exit normally even if our timer is pending.
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }

  return nextConfigFn
}

function normalizeReleaseId(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
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
  const turbopackEnabled = utils.isTurbopackEnabled()
  return (config: any, options: any) => {
    const webpackConfig = defaultWebpackConfig(config, options)
    if (sourceMapEnabled) {
      if (!turbopackEnabled) {
        webpackConfig.plugins = webpackConfig.plugins || []
        webpackConfig.plugins.push(new PosthogWebpackPlugin(posthogConfig, true))
      }
    }
    return webpackConfig
  }
}

function withCompilerConfig(
  userCompilerConfig: NextConfig['compiler'],
  posthogConfig: ResolvedPluginConfig,
  nativeDebugIdsEnabled: boolean
): NextConfig['compiler'] {
  const sourceMapEnabled = posthogConfig.sourcemaps.enabled
  const turbopackEnabled = utils.isTurbopackEnabled()
  if (sourceMapEnabled && turbopackEnabled && utils.hasCompilerHook()) {
    const newConfig = userCompilerConfig || {}
    const userCompilerHook = userCompilerConfig?.runAfterProductionCompile
    newConfig.runAfterProductionCompile = async (config: { distDir: string; projectDir: string }) => {
      await userCompilerHook?.(config)
      console.debug('Processing source maps from compilation hook...')
      await utils.processSourceMaps(posthogConfig, config.distDir, nativeDebugIdsEnabled ? 'upload' : 'process')
      if (posthogConfig.sourcemaps.deleteAfterUpload) {
        if (nativeDebugIdsEnabled) {
          await deleteSourceMapFiles(config.distDir)
        } else {
          await stripDanglingSourceMapComments(config.distDir)
        }
      }
    }
    return newConfig
  }
  return userCompilerConfig
}
