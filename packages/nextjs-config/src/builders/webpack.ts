import type { NextConfig } from 'next'
import type { PostHogNextConfigComplete } from '../types'
import { SourcemapWebpackPlugin } from '../webpack-plugin'
import type { Configuration } from 'webpack'

// Build config for Webpack
export function buildWebpackConfig(
  resolvedUserConfig: NextConfig,
  posthogNextConfigComplete: PostHogNextConfigComplete
): NextConfig {
  const { webpack: userWebpackConfig, ...configWithoutWebpack } = resolvedUserConfig

  return {
    ...configWithoutWebpack,
    productionBrowserSourceMaps: true,
    webpack: (
      config: Configuration,
      options: Parameters<NonNullable<NextConfig['webpack']>>[1]
    ): Configuration => {
      // Call user's webpack config if they have one, otherwise just pass through
      const webpackConfig = userWebpackConfig ? userWebpackConfig(config, options) : config

      if (webpackConfig && options.isServer) {
        webpackConfig.devtool = 'source-map'
      }
      webpackConfig.plugins = webpackConfig.plugins || []
      webpackConfig.plugins.push(
        new SourcemapWebpackPlugin(
          posthogNextConfigComplete,
          options.isServer,
          options.nextRuntime,
          resolvedUserConfig.distDir
        )
      )

      return webpackConfig
    },
  }
}
