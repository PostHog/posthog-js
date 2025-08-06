import type { NextConfig } from 'next'
import type { PostHogNextConfigComplete } from '../types'
import { processTurbopackSourcemaps } from '../turbopack-handler'
import { checkNextJsVersionAndWarn } from '../utils/version-check'

// Build config for Turbopack
export function buildTurbopackConfig(
  resolvedUserConfig: NextConfig,
  posthogNextConfigComplete: PostHogNextConfigComplete
): NextConfig {
  // Check version and warn if needed when in production
  if (process.env.NODE_ENV === 'production') {
    checkNextJsVersionAndWarn()
  }

  return {
    ...resolvedUserConfig,
    productionBrowserSourceMaps: true,
    ...(process.env.NODE_ENV === 'production'
      ? {
          compiler: {
            runAfterProductionCompile: async () => {
              try {
                // Call user's hook first if it exists
                if (resolvedUserConfig.runAfterProductionCompile) {
                  await resolvedUserConfig.runAfterProductionCompile()
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
          },
        }
      : {}),
  }
}
