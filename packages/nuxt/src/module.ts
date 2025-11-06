import { defineNuxtModule, addPlugin, createResolver, addServerPlugin } from '@nuxt/kit'
import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import { resolveBinaryPath, spawnLocal } from '@posthog/core/process'
import { fileURLToPath } from 'node:url'
import path, { dirname } from 'node:path'
import type { NuxtOptions } from 'nuxt/schema'

const filename = fileURLToPath(import.meta.url)
const resolvedDirname = dirname(filename)

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface SourcemapsConfig {
  enabled: boolean
  personalApiKey: string
  envId: string
  version?: string
  project?: string
  logLevel?: LogLevel
  deleteAfterUpload?: boolean
}

export interface ModuleOptions {
  host: string
  publicKey: string
  debug?: boolean
  cliBinaryPath?: string
  clientConfig?: PostHogClientConfig
  serverConfig?: PostHogServerConfig
  sourcemaps: SourcemapsConfig | undefined
}

export interface PostHogCommon {
  publicKey: string
  host: string
  debug?: boolean
}

export type PostHogServerConfig = PostHogOptions
export type PostHogClientConfig = Partial<PostHogConfig>

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@posthog/nuxt',
    configKey: 'posthogConfig',
    compatibility: {
      nuxt: '>=3.7.0',
    },
  },
  defaults: () => ({
    host: 'https://us.i.posthog.com',
    debug: false,
    clientConfig: {},
    serverConfig: {},
  }),

  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    addPlugin(resolver.resolve('./runtime/vue-plugin'))
    addServerPlugin(resolver.resolve('./runtime/nitro-plugin'))

    Object.assign(nuxt.options.runtimeConfig.public, {
      posthog: {
        publicKey: options.publicKey,
        host: options.host,
        debug: options.debug,
      },
      posthogClientConfig: options.clientConfig,
    })

    Object.assign(nuxt.options.runtimeConfig, {
      posthogServerConfig: options.serverConfig,
    })

    if (!options.sourcemaps?.enabled || nuxt.options.dev) {
      return
    }

    const sourcemapsConfig = options.sourcemaps

    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.rollupConfig = {
        ...(nitroConfig.rollupConfig || {}),
        output: {
          ...(nitroConfig.rollupConfig?.output || {}),
          sourcemapExcludeSources: false, // Make sure to set it (otherwise server sourcemaps will not be generated)
        },
      }
    })

    nuxt.hook('build:before', () => {
      nuxt.options.sourcemap = {
        client: 'hidden',
        server: 'hidden',
      }
    })

    const outputDir = getOutputDir(nuxt.options.nitro)
    let isBuildProcess = false

    const posthogCliRunner = () => {
      const cliBinaryPath =
        options.cliBinaryPath ||
        resolveBinaryPath('posthog-cli', {
          path: process.env.PATH ?? '',
          cwd: resolvedDirname,
        })
      const logLevel = sourcemapsConfig.logLevel || 'info'
      const cliEnv = {
        ...process.env,
        RUST_LOG: `posthog_cli=${logLevel}`,
        POSTHOG_CLI_HOST: options.host,
        POSTHOG_CLI_ENV_ID: sourcemapsConfig.envId,
        POSTHOG_CLI_TOKEN: sourcemapsConfig.personalApiKey,
      }
      return (args: string[]) => {
        return spawnLocal(cliBinaryPath, args, {
          env: cliEnv,
          cwd: process.cwd(),
          stdio: 'inherit',
        })
      }
    }

    const cliRunner = posthogCliRunner()

    nuxt.hook('nitro:build:public-assets', async () => {
      isBuildProcess = true
      try {
        // Inject public sourcemaps
        // This cannot be done in the close hook. https://github.com/PostHog/posthog/issues/30957#issuecomment-2824545454
        await cliRunner(getInjectArgs(path.join(outputDir, 'public'), sourcemapsConfig))
      } catch (error) {
        console.error('Failed to process public sourcemaps:', error)
      }
    })

    nuxt.hook('close', async () => {
      // We don't want to run this process during prepare and friends
      if (!isBuildProcess) return
      try {
        // Inject server sourcemaps
        await cliRunner(getInjectArgs(path.join(outputDir, 'server'), sourcemapsConfig))
        // Upload all assets
        await cliRunner(getUploadArgs(outputDir, sourcemapsConfig))
      } catch (error) {
        console.error('Failed to process server sourcemaps:', error)
      }
    })
  },
})

function getInjectArgs(directory: string, sourcemapsConfig: SourcemapsConfig) {
  const processOptions: string[] = ['sourcemap', 'inject', '--ignore', '**/node_modules/**', '--directory', directory]

  if (sourcemapsConfig.project) {
    processOptions.push('--project', sourcemapsConfig.project)
  }

  if (sourcemapsConfig.version) {
    processOptions.push('--version', sourcemapsConfig.version)
  }

  return processOptions
}

function getUploadArgs(directory: string, sourcemapsConfig: SourcemapsConfig) {
  const processOptions: string[] = ['sourcemap', 'upload', '--ignore', '**/node_modules/**', '--directory', directory]

  if (sourcemapsConfig.deleteAfterUpload ?? true) {
    processOptions.push('--delete-after')
  }

  return processOptions
}

function getOutputDir(nitroConfig: NuxtOptions['nitro']): string {
  if (nitroConfig.preset && nitroConfig.preset.includes('vercel')) {
    return '.vercel/output'
  }
  if (nitroConfig.output && nitroConfig.output.dir) {
    return nitroConfig.output.dir
  }
  return '.output'
}
