import type { NextConfig } from 'next'
import type { PostHogNextConfigComplete, ExtendedNextConfig } from '../types'
import { processTurbopackSourcemaps } from '../turbopack-handler'
import { checkNextJsVersionAndWarn } from '../utils/version-check'

// Build config for Turbopack
export function buildTurbopackConfig(
  resolvedUserConfig: NextConfig,
  posthogNextConfigComplete: PostHogNextConfigComplete
): ExtendedNextConfig {
  // Check version and warn if needed when in production
  if (process.env.NODE_ENV === 'production') {
    checkNextJsVersionAndWarn()
  }

  const config: ExtendedNextConfig = {
    ...resolvedUserConfig,
    productionBrowserSourceMaps: true,
  }

  if (process.env.NODE_ENV === 'production') {
    config.compiler = {
      ...resolvedUserConfig.compiler,
      runAfterProductionCompile: async () => {
        try {
          // Call user's hook first if it exists
          const userCompiler = resolvedUserConfig.compiler as ExtendedNextConfig['compiler']
          if (userCompiler?.runAfterProductionCompile) {
            await userCompiler.runAfterProductionCompile()
          }
          // Then process sourcemaps
          await processTurbopackSourcemaps(posthogNextConfigComplete, resolvedUserConfig.distDir)
        } catch (error) {
          console.error('PostHog: Failed to process sourcemaps after production build:', error)
          if (posthogNextConfigComplete.sourcemaps.failOnError) {
            throw error
          }
        }
      },
    }
  }

  return config
}
