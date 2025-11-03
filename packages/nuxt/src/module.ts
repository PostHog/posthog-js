import { defineNuxtModule, addPlugin, createResolver, addServerPlugin } from '@nuxt/kit'
import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import { spawnLocal } from '@posthog/core/process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

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

    nuxt.hook('build:done', async () => {
      try {
        const buildDir = nuxt.options.buildDir

        const processOptions: string[] = [
          '--host',
          options.host,
          'sourcemap',
          'process',
          '--ignore',
          '**/node_modules/**',
        ]

        if (sourcemapsConfig.project) {
          processOptions.push('--project', sourcemapsConfig.project)
        }

        if (sourcemapsConfig.version) {
          processOptions.push('--version', sourcemapsConfig.version)
        }

        if (sourcemapsConfig.deleteAfterUpload ?? true) {
          processOptions.push('--delete-after')
        }

        await spawnLocal('posthog-cli', [...processOptions, '--directory', buildDir], {
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
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('PostHog sourcemap process failed:', error)
      }
    })
  },
})
