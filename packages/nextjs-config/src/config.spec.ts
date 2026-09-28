import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { NextConfig } from 'next'
import * as utils from './utils'
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

describe('withPostHogConfig Turbopack sourcemap hook', () => {
  let distDir: string

  beforeEach(async () => {
    vi.stubEnv('TURBOPACK', '1')
    distDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-next-hook-'))
    await fs.mkdir(path.join(distDir, 'static'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await fs.rm(distDir, { recursive: true, force: true })
  })

  it.each([true, false])(
    'runs the user hook before upload and only strips deleted maps (delete=%s)',
    async (deleteAfterUpload) => {
      const files = {
        'deleted.js': 'a();\n//# sourceMappingURL=deleted.js.map\n',
        'retained.js': 'b();\n//# sourceMappingURL=retained.js.map\n',
        'missing.js': 'c();\n//# sourceMappingURL=missing.js.map\n',
        'remote.js': 'd();\n//# sourceMappingURL=https://cdn.example.com/remote.map\n',
        'inline.js': 'e();\n//# sourceMappingURL=data:application/json;base64,e30=\n',
      }
      for (const [file, code] of Object.entries(files)) await fs.writeFile(path.join(distDir, 'static', file), code)
      await fs.writeFile(path.join(distDir, 'static/deleted.js.map'), '{}')
      await fs.writeFile(path.join(distDir, 'static/retained.js.map'), '{}')
      const order: string[] = []
      const userHook = vi.fn(async () => {
        order.push('user')
      })
      const processMaps = vi.spyOn(utils, 'processSourceMaps').mockImplementation(async () => {
        order.push('upload')
        expect(await fs.readFile(path.join(distDir, 'static/deleted.js'), 'utf8')).toBe(files['deleted.js'])
        if (deleteAfterUpload) await fs.rm(path.join(distDir, 'static/deleted.js.map'))
      })
      const config = await resolveNextConfig(
        { compiler: { runAfterProductionCompile: userHook } },
        {
          ...pluginConfig,
          sourcemaps: { enabled: true, deleteAfterUpload },
        }
      )
      await config.compiler!.runAfterProductionCompile!({ distDir, projectDir: distDir })
      expect(order).toEqual(['user', 'upload'])
      expect(userHook).toHaveBeenCalledWith({ distDir, projectDir: distDir })
      expect(processMaps).toHaveBeenCalledTimes(1)
      for (const [file, code] of Object.entries(files)) {
        const stripped = deleteAfterUpload && (file === 'deleted.js' || file === 'missing.js')
        expect(await fs.readFile(path.join(distDir, 'static', file), 'utf8')).toBe(
          stripped ? code.split('\n')[0] + '\n' : code
        )
      }
    }
  )
})
