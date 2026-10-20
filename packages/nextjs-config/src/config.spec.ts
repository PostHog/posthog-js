import fs from 'node:fs/promises'
import os from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { NextConfig } from 'next'
import * as utils from './utils'
import { PosthogWebpackPlugin, type PluginConfig } from '@posthog/webpack-plugin'
import { withPostHogConfig } from './config'

vi.mock('next/package.json', () => ({ default: { version: '16.3.8' } }))

vi.mock('@posthog/webpack-plugin', async (importOriginal) => {
  const original = await importOriginal<typeof import('@posthog/webpack-plugin')>()
  return {
    ...original,
    PosthogWebpackPlugin: vi.fn(
      (...args: ConstructorParameters<typeof original.PosthogWebpackPlugin>) =>
        new original.PosthogWebpackPlugin(...args)
    ),
  }
})

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
  const originalArgv = process.argv

  beforeEach(() => {
    vi.stubEnv('WEBPACK', '1')
    vi.stubEnv('TURBOPACK', '')
    vi.stubEnv('POSTHOG_RELEASE_ID', '')
    vi.spyOn(utils, 'resolveReleaseId').mockResolvedValue('webpack-release')
  })

  afterEach(() => {
    process.argv = originalArgv
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('uses webpack instrumentation for Next 16 --webpack, without the Turbopack upload hook', async () => {
    process.argv = ['node', 'next', 'build', '--webpack']
    vi.stubEnv('WEBPACK', undefined)
    vi.stubEnv('TURBOPACK', undefined)
    const userHook = vi.fn()
    const userWebpack = vi.fn((config) => config)
    const config = await resolveNextConfig({
      webpack: userWebpack,
      compiler: { runAfterProductionCompile: userHook },
    })

    expect(utils.getNextJsVersion()).toBe('16.3.8')
    expect(config.turbopack).toBeUndefined()
    expect(config.compiler?.runAfterProductionCompile).toBe(userHook)
    expect(config.env).toEqual({ POSTHOG_RELEASE_ID: 'webpack-release' })
    expect(utils.resolveReleaseId).toHaveBeenCalledTimes(1)
    getPostHogPlugin(config, false)
    getPostHogPlugin(config, true)
    expect(userWebpack).toHaveBeenCalledTimes(2)
    expect(PosthogWebpackPlugin).toHaveBeenCalledTimes(2)
    expect(PosthogWebpackPlugin).toHaveBeenCalledWith(expect.anything(), true, { injectReleaseId: false })
  })

  it('resolves one build-time release for client and server without late injection', async () => {
    const configFunction = withPostHogConfig({}, pluginConfig) as unknown as (
      phase: string,
      context: { defaultConfig: NextConfig }
    ) => Promise<NextConfig>
    const first = await configFunction('phase-production-build', { defaultConfig: {} })
    const second = await configFunction('phase-production-build', { defaultConfig: {} })

    expect(first.env).toEqual({ POSTHOG_RELEASE_ID: 'webpack-release' })
    expect(second.env).toEqual(first.env)
    expect(utils.resolveReleaseId).toHaveBeenCalledTimes(1)
    expect(first.turbopack).toBeUndefined()
    getPostHogPlugin(first, false)
    getPostHogPlugin(first, true)
    expect(PosthogWebpackPlugin).toHaveBeenCalledTimes(2)
    expect(PosthogWebpackPlugin).toHaveBeenCalledWith(expect.anything(), true, { injectReleaseId: false })
  })

  it.each([
    [{ EXISTING: 'value', POSTHOG_RELEASE_ID: ' configured-release ' }, 'configured-release'],
    [{ EXISTING: 'value', POSTHOG_RELEASE_ID: ' ' }, 'environment-release'],
  ])('uses an explicit release without resolving another one', async (env, expected) => {
    vi.stubEnv('POSTHOG_RELEASE_ID', ' environment-release ')
    const config = await resolveNextConfig({ env })

    expect(config.env).toEqual({ EXISTING: 'value', POSTHOG_RELEASE_ID: expected })
    expect(utils.resolveReleaseId).not.toHaveBeenCalled()
    getPostHogPlugin(config, false)
    expect(PosthogWebpackPlugin).toHaveBeenCalledWith(expect.anything(), true, { injectReleaseId: false })
  })

  it('leaves symbol-set mode on its existing path', async () => {
    const config = await resolveNextConfig(
      {},
      {
        ...pluginConfig,
        sourcemaps: { releaseMode: 'symbol-set' },
      }
    )

    expect(config.env).toBeUndefined()
    expect(utils.resolveReleaseId).not.toHaveBeenCalled()
    getPostHogPlugin(config, false)
    expect(PosthogWebpackPlugin).toHaveBeenCalledWith(expect.anything(), true, { injectReleaseId: true })
  })

  it('does not resolve a release or add a plugin when source maps are disabled', async () => {
    const config = await resolveNextConfig({}, { ...pluginConfig, sourcemaps: { enabled: false } })

    expect(config.env).toBeUndefined()
    expect(utils.resolveReleaseId).not.toHaveBeenCalled()
    config.webpack?.({ plugins: [] }, {} as any)
    expect(PosthogWebpackPlugin).not.toHaveBeenCalled()
  })

  it.each(['phase-development-server', 'phase-production-server'])(
    'does not resolve a release during %s',
    async (phase) => {
      const configFunction = withPostHogConfig({}, pluginConfig) as unknown as (
        phase: string,
        context: { defaultConfig: NextConfig }
      ) => Promise<NextConfig>
      await configFunction(phase, { defaultConfig: {} })
      expect(utils.resolveReleaseId).not.toHaveBeenCalled()
    }
  )

  it.each(['missing', 'failed'])('continues without late injection when release resolution is %s', async (result) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    if (result === 'failed') vi.mocked(utils.resolveReleaseId).mockRejectedValue(new Error('offline'))
    else vi.mocked(utils.resolveReleaseId).mockResolvedValue(undefined)

    const config = await resolveNextConfig({})

    expect(config.env).toBeUndefined()
    getPostHogPlugin(config, false)
    expect(PosthogWebpackPlugin).toHaveBeenCalledWith(expect.anything(), true, { injectReleaseId: false })
    if (result === 'failed') expect(warn).toHaveBeenCalled()
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
          sourcemaps: { enabled: true, deleteAfterUpload, releaseMode: 'symbol-set' },
        }
      )
      await config.compiler!.runAfterProductionCompile!({ distDir, projectDir: distDir })
      expect(order).toEqual(['user', 'upload'])
      expect(userHook).toHaveBeenCalledWith({ distDir, projectDir: distDir })
      expect(processMaps).toHaveBeenCalledTimes(1)
      expect(processMaps).toHaveBeenCalledWith(expect.anything(), distDir, 'process')
      for (const [file, code] of Object.entries(files)) {
        const stripped = deleteAfterUpload && (file === 'deleted.js' || file === 'missing.js')
        expect(await fs.readFile(path.join(distDir, 'static', file), 'utf8')).toBe(
          stripped ? code.split('\n')[0] + '\n' : code
        )
      }
    }
  )

  it('uses its own CLI dependency instead of a workspace binary for release resolution and upload', async () => {
    vi.spyOn(utils, 'supportsTurbopackDebugIds').mockReturnValue(true)
    const resolveRelease = vi.spyOn(utils, 'resolveReleaseId').mockResolvedValue('release-id')
    const processMaps = vi.spyOn(utils, 'processSourceMaps').mockResolvedValue(undefined)
    const workspaceBinDir = path.join(distDir, 'node_modules/.bin')
    await fs.mkdir(workspaceBinDir, { recursive: true })
    await fs.writeFile(path.join(workspaceBinDir, 'posthog-cli'), 'outdated workspace CLI')
    vi.spyOn(process, 'cwd').mockReturnValue(distDir)
    vi.stubEnv('PATH', workspaceBinDir)
    const ownCliPath = createRequire(new URL('../package.json', import.meta.url)).resolve(
      '@posthog/cli/run-posthog-cli.js'
    )

    const config = await resolveNextConfig({}, { ...pluginConfig, cliBinaryPath: undefined })
    await config.compiler!.runAfterProductionCompile!({ distDir, projectDir: distDir })

    expect(resolveRelease).toHaveBeenCalledWith(expect.objectContaining({ cliBinaryPath: ownCliPath }))
    expect(processMaps).toHaveBeenCalledWith(expect.objectContaining({ cliBinaryPath: ownCliPath }), distDir, 'upload')
  })

  it('enables native debug IDs and embeds one automatically resolved release id', async () => {
    vi.spyOn(utils, 'supportsTurbopackDebugIds').mockReturnValue(true)
    const resolveRelease = vi.spyOn(utils, 'resolveReleaseId').mockResolvedValue('resolved-release-id')
    const configFunction = withPostHogConfig({ turbopack: { root: '/project' } }, pluginConfig) as unknown as (
      phase: string,
      context: { defaultConfig: NextConfig }
    ) => Promise<NextConfig>

    const first = await configFunction('phase-production-build', { defaultConfig: {} })
    const second = await configFunction('phase-production-build', { defaultConfig: {} })

    expect(first.turbopack).toEqual({ root: '/project', debugIds: true })
    expect(first.env).toEqual({ POSTHOG_RELEASE_ID: 'resolved-release-id' })
    expect(second.env).toEqual({ POSTHOG_RELEASE_ID: 'resolved-release-id' })
    expect(resolveRelease).toHaveBeenCalledTimes(1)
  })

  it('prefers an explicit release id and preserves the user environment', async () => {
    vi.spyOn(utils, 'supportsTurbopackDebugIds').mockReturnValue(true)
    const resolveRelease = vi.spyOn(utils, 'resolveReleaseId')

    const config = await resolveNextConfig({
      env: { EXISTING: 'value', POSTHOG_RELEASE_ID: '  configured-release-id  ' },
    })

    expect(config.env).toEqual({ EXISTING: 'value', POSTHOG_RELEASE_ID: 'configured-release-id' })
    expect(resolveRelease).not.toHaveBeenCalled()
  })

  it('prefers the build environment release id when the config does not set one', async () => {
    vi.spyOn(utils, 'supportsTurbopackDebugIds').mockReturnValue(true)
    vi.stubEnv('POSTHOG_RELEASE_ID', '  build-release-id  ')
    const resolveRelease = vi.spyOn(utils, 'resolveReleaseId')

    const config = await resolveNextConfig({ env: { EXISTING: 'value', POSTHOG_RELEASE_ID: '  ' } })

    expect(config.env).toEqual({ EXISTING: 'value', POSTHOG_RELEASE_ID: 'build-release-id' })
    expect(resolveRelease).not.toHaveBeenCalled()
  })

  it('uploads native debug ID maps without rewriting JavaScript', async () => {
    vi.spyOn(utils, 'supportsTurbopackDebugIds').mockReturnValue(true)
    vi.spyOn(utils, 'resolveReleaseId').mockResolvedValue(undefined)
    const source = 'a();\n//# debugId=00000000-0000-4000-8000-000000000001\n//# sourceMappingURL=app.js.map\n'
    await fs.writeFile(path.join(distDir, 'static/app.js'), source)
    await fs.writeFile(path.join(distDir, 'static/app.js.map'), '{}')
    await fs.mkdir(path.join(distDir, 'server'))
    await fs.writeFile(path.join(distDir, 'server/app.js.map'), '{}')
    const processMaps = vi.spyOn(utils, 'processSourceMaps').mockImplementation(async () => undefined)
    const config = await resolveNextConfig({})

    await config.compiler!.runAfterProductionCompile!({ distDir, projectDir: distDir })

    expect(processMaps).toHaveBeenCalledWith(
      expect.objectContaining({ cliBinaryPath: pluginConfig.cliBinaryPath }),
      distDir,
      'upload'
    )
    expect(await fs.readFile(path.join(distDir, 'static/app.js'), 'utf8')).toBe(source)
    await expect(fs.access(path.join(distDir, 'static/app.js.map'))).rejects.toThrow()
    await expect(fs.access(path.join(distDir, 'server/app.js.map'))).rejects.toThrow()
  })
})
