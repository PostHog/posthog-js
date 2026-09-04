import type { NextConfig } from 'next'
import { PosthogWebpackPlugin, type PluginConfig } from '@posthog/webpack-plugin'
import { withPostHogConfig } from './config'

const pluginConfig: PluginConfig = {
  personalApiKey: 'phx_test',
  projectId: '1',
  cliBinaryPath: 'posthog-cli',
  sourcemaps: {
    enabled: true,
    deleteAfterUpload: true,
  },
}

async function resolveNextConfig(userConfig: NextConfig, posthogConfig = pluginConfig): Promise<NextConfig> {
  const configFunction = withPostHogConfig(userConfig, posthogConfig) as unknown as (
    phase: string,
    context: { defaultConfig: NextConfig }
  ) => Promise<NextConfig>

  return configFunction('phase-production-build', { defaultConfig: {} })
}

function getPostHogPlugin(config: NextConfig, isServer: boolean): PosthogWebpackPlugin {
  const webpackConfig = config.webpack?.({ plugins: [] }, { isServer } as any)
  return webpackConfig.plugins.at(-1) as PosthogWebpackPlugin
}

describe('withPostHogConfig webpack sourcemaps', () => {
  beforeEach(() => {
    process.env.WEBPACK = '1'
    delete process.env.TURBOPACK
  })

  afterEach(() => {
    delete process.env.WEBPACK
  })

  it('deletes server sourcemaps and excludes them from output file tracing', async () => {
    const config = await resolveNextConfig({})

    expect(config.outputFileTracingExcludes).toEqual({
      '*': ['.next/server/**/*.map'],
    })
    expect(getPostHogPlugin(config, true).resolvedConfig.sourcemaps.deleteAfterUpload).toBe(true)
  })

  it('preserves output file tracing exclusions and uses a custom distDir', async () => {
    const config = await resolveNextConfig({
      distDir: 'build',
      outputFileTracingExcludes: {
        '*': ['./existing/**/*'],
        '/api/test': ['./api-only/**/*'],
      },
    })

    expect(config.outputFileTracingExcludes).toEqual({
      '*': ['./existing/**/*', 'build/server/**/*.map'],
      '/api/test': ['./api-only/**/*'],
    })
  })

  it('keeps server sourcemaps when deleteAfterUpload is disabled', async () => {
    const outputFileTracingExcludes = {
      '*': ['./existing/**/*'],
    }
    const config = await resolveNextConfig(
      { outputFileTracingExcludes },
      {
        ...pluginConfig,
        sourcemaps: {
          ...pluginConfig.sourcemaps,
          deleteAfterUpload: false,
        },
      }
    )

    expect(config.outputFileTracingExcludes).toBe(outputFileTracingExcludes)
    expect(getPostHogPlugin(config, true).resolvedConfig.sourcemaps.deleteAfterUpload).toBe(false)
  })
})
