import type { NextConfig } from 'next'
import { createRequire } from 'node:module'
import path from 'node:path'
import { PosthogWebpackPlugin, PluginConfig, resolveConfig, ResolvedPluginConfig } from '@posthog/webpack-plugin'
import * as utils from './utils'
import { deleteSourceMapFiles, stripDanglingSourceMapComments } from './strip-sourcemap-comments'
import { injectServerRelease } from './inject-server-release'

type NextFuncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => NextConfig
type NextAsyncConfig = (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => Promise<NextConfig>
type UserProvidedConfig = NextConfig | NextFuncConfig | NextAsyncConfig
type TurbopackConfigWithDebugIds = NonNullable<NextConfig['turbopack']> & { debugIds: boolean }

// How long after `withPostHogConfig` returns we wait before deciding that
// Next.js (or an outer wrapper) never invoked our config function. See the
// comment inside `withPostHogConfig` for the full reasoning.
const INVOCATION_TIMEOUT_MS = 5000

export function withPostHogConfig(userNextConfig: UserProvidedConfig, posthogConfig: PluginConfig): NextConfig {
  const resolvedConfig = resolveConfig({
    ...posthogConfig,
    cliBinaryPath:
      posthogConfig.cliBinaryPath ??
      createRequire(path.join(__dirname, '../package.json')).resolve('@posthog/cli/run-posthog-cli.js'),
  })
  const sourceMapEnabled = resolvedConfig.sourcemaps.enabled
  const isCompilerHookSupported = utils.hasCompilerHook()
  // Select the integration once per wrapper. Hook builders must not independently redetect
  // the bundler from ambient state (which differs between Next's parent and worker processes).
  const turbopackEnabled = utils.isTurbopackEnabled()
  const nativeDebugIdsEnabled =
    turbopackEnabled &&
    sourceMapEnabled &&
    resolvedConfig.sourcemaps.releaseMode === 'event' &&
    utils.supportsTurbopackDebugIds()
  const buildTimeReleaseEnabled =
    sourceMapEnabled &&
    resolvedConfig.sourcemaps.releaseMode === 'event' &&
    (!turbopackEnabled || nativeDebugIdsEnabled)
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
    let releaseId =
      normalizeReleaseId(userEnv?.POSTHOG_RELEASE_ID) ?? normalizeReleaseId(process.env.POSTHOG_RELEASE_ID)
    if (!releaseId && buildTimeReleaseEnabled && phase === 'phase-production-build') {
      releaseIdPromise ??= utils.resolveReleaseId(resolvedConfig).catch((error) => {
        if (turbopackEnabled || resolvedConfig.sourcemaps.failOnError) throw error
        // Preserve webpack's fail-soft behavior, without falling back to late release injection.
        console.warn('[@posthog/nextjs-config] Could not resolve the release id; continuing without it.', error)
        return undefined
      })
      releaseId = await releaseIdPromise
    }
    const nextConfig: NextConfig = {
      ...userConfig,
      ...(userTurbopackConfig ? { turbopack: userTurbopackConfig } : {}),
      ...(userEnv ? { env: userEnv } : {}),
      distDir,
      webpack:
        sourceMapEnabled && !turbopackEnabled
          ? withWebpackConfig(userWebPackConfig, resolvedConfig, releaseId)
          : userWebPackConfig,
      compiler:
        sourceMapEnabled && turbopackEnabled && isCompilerHookSupported
          ? withCompilerConfig(userCompilerConfig, resolvedConfig, nativeDebugIdsEnabled, releaseId)
          : userCompilerConfig,
    }
    if (nativeDebugIdsEnabled) {
      const turbopackConfig: TurbopackConfigWithDebugIds = { ...userTurbopackConfig, debugIds: true }
      nextConfig.turbopack = turbopackConfig
    }
    if (buildTimeReleaseEnabled && releaseId) {
      // Next compiles this lookup in the SDK before webpack computes chunk hashes. Do not put
      // per-deploy metadata in browser assets after hashing: Next 14 app-router uses [chunkhash].
      nextConfig.env = { ...userEnv, POSTHOG_RELEASE_ID: releaseId }
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

function withWebpackConfig(
  userWebpackConfig: NextConfig['webpack'],
  posthogConfig: ResolvedPluginConfig,
  releaseId: string | undefined
) {
  const defaultWebpackConfig = userWebpackConfig || ((config: any) => config)
  return (config: any, options: any) => {
    const webpackConfig = defaultWebpackConfig(config, options)
    webpackConfig.plugins = webpackConfig.plugins || []
    // CDN-loaded browser SDKs and externalized server SDKs bypass DefinePlugin. Embed the
    // same release in both runtimes before hashing, without resolving it again or mutating assets late.
    webpackConfig.plugins.push(new PosthogWebpackPlugin(posthogConfig, true, { mode: 'runtime', releaseId }))
    return webpackConfig
  }
}

function withCompilerConfig(
  userCompilerConfig: NextConfig['compiler'],
  posthogConfig: ResolvedPluginConfig,
  nativeDebugIdsEnabled: boolean,
  releaseId: string | undefined
): NextConfig['compiler'] {
  const userCompilerHook = userCompilerConfig?.runAfterProductionCompile
  return {
    ...userCompilerConfig,
    runAfterProductionCompile: async (config: { distDir: string; projectDir: string }) => {
      await userCompilerHook?.(config)
      if (nativeDebugIdsEnabled && releaseId) await injectServerRelease(config.distDir, releaseId)
      console.debug('Processing source maps from compilation hook...')
      await utils.processSourceMaps(posthogConfig, config.distDir, nativeDebugIdsEnabled ? 'upload' : 'process')
      if (posthogConfig.sourcemaps.deleteAfterUpload) {
        if (nativeDebugIdsEnabled) {
          await deleteSourceMapFiles(config.distDir)
        } else {
          await stripDanglingSourceMapComments(config.distDir)
        }
      }
    },
  }
}
