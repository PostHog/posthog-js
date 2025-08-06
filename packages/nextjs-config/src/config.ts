import type { NextConfig } from 'next'
import type { PostHogNextConfig, UserProvidedConfig } from './types'
import { buildTurbopackConfig } from './builders/turbopack'
import { buildWebpackConfig } from './builders/webpack'
import { isTurbopackEnabled } from './utils/bundler-detection'
import { resolveUserConfig, resolvePostHogConfig } from './utils/config-resolution'

export function withPostHogConfig(userNextConfig: UserProvidedConfig, posthogConfig: PostHogNextConfig): NextConfig {
  const posthogNextConfigComplete = resolvePostHogConfig(posthogConfig)
  return async (phase: string, { defaultConfig }: { defaultConfig: NextConfig }) => {
    const resolvedUserConfig = await resolveUserConfig(userNextConfig, phase, defaultConfig)
    const sourceMapEnabled = posthogNextConfigComplete.sourcemaps.enabled

    // Early return if sourcemaps are not enabled
    if (!sourceMapEnabled) {
      return resolvedUserConfig
    }

    // Determine bundler and return appropriate config
    const isTurbopack = isTurbopackEnabled(resolvedUserConfig)

    return isTurbopack
      ? buildTurbopackConfig(resolvedUserConfig, posthogNextConfigComplete)
      : buildWebpackConfig(resolvedUserConfig, posthogNextConfigComplete)
  }
}
