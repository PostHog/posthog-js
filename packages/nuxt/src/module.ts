import { defineNuxtModule, addPlugin, createResolver, addServerPlugin } from '@nuxt/kit'
import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import { spawnLocal } from '@posthog/core/process'
import { fileURLToPath } from 'node:url'
import path, { dirname } from 'node:path'
import type { NuxtOptions } from 'nuxt/schema'

const filename = fileURLToPath(import.meta.url)
const resolvedDirname = dirname(filename)

interface DisabledSourcemaps {
  enabled: false
}

interface EnabledSourcemaps {
  enabled: true
  personalApiKey: string
  envId: string
  version?: string
  project?: string
  verbose?: boolean
  deleteAfterUpload?: boolean
}

export interface ModuleOptions {
  host: string
  publicKey: string
  debug?: boolean
  clientConfig?: PostHogClientConfig
  serverConfig?: PostHogServerConfig
  sourcemaps: DisabledSourcemaps | EnabledSourcemaps | undefined
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

    const sourcemapsConfig = options.sourcemaps as EnabledSourcemaps

    if (!sourcemapsConfig?.enabled || nuxt.options.dev) {
      return
    }

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

    nuxt.hook('nitro:build:public-assets', async () => {
      isBuildProcess = true
      try {
        // Inject public sourcemaps
        // This cannot be done in the close hook. https://github.com/PostHog/posthog/issues/30957#issuecomment-2824545454
        await runInject(path.join(outputDir, 'public'), options.host, sourcemapsConfig)
      } catch (error) {
        console.error('Failed to process public sourcemaps:', error)
      }
    })

    nuxt.hook('close', async () => {
      if (!isBuildProcess) return
      try {
        // Inject server sourcemaps
        await runInject(path.join(outputDir, 'server'), options.host, sourcemapsConfig)
        // Upload all assets
        await runUpload(outputDir, options.host, sourcemapsConfig)
      } catch (error) {
        console.error('Failed to process server sourcemaps:', error)
      }
    })
  },
})

async function runInject(directory: string, host: string, sourcemapsConfig: EnabledSourcemaps) {
  const processOptions: string[] = ['--host', host, 'sourcemap', 'process', '--ignore', '**/node_modules/**']

  if (sourcemapsConfig.project) {
    processOptions.push('--project', sourcemapsConfig.project)
  }

  if (sourcemapsConfig.version) {
    processOptions.push('--version', sourcemapsConfig.version)
  }

  await spawnLocal('posthog-cli', [...processOptions, '--directory', directory], {
    env: {
      ...process.env,
      POSTHOG_CLI_ENV_ID: sourcemapsConfig.envId,
      POSTHOG_CLI_TOKEN: sourcemapsConfig.personalApiKey,
    },
    cwd: process.cwd(),
    resolveFrom: resolvedDirname,
    stdio: 'inherit',
    onBinaryFound: () => {},
  })
}

async function runUpload(directory: string, host: string, sourcemapsConfig: EnabledSourcemaps) {
  const processOptions: string[] = ['--host', host, 'sourcemap', 'upload', '--ignore', '**/node_modules/**']

  if (sourcemapsConfig.deleteAfterUpload ?? true) {
    processOptions.push('--delete-after')
  }

  await spawnLocal('posthog-cli', [...processOptions, '--directory', directory], {
    env: {
      ...process.env,
      POSTHOG_CLI_ENV_ID: sourcemapsConfig.envId,
      POSTHOG_CLI_TOKEN: sourcemapsConfig.personalApiKey,
    },
    cwd: process.cwd(),
    resolveFrom: resolvedDirname,
    stdio: 'inherit',
    onBinaryFound: () => {},
  })
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
