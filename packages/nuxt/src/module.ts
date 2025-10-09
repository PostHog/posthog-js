import { defineNuxtModule, addPlugin, createResolver, addServerPlugin } from '@nuxt/kit'
import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import { spawnLocal } from '@posthog/core/process'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const VUE_OUTPUT_DIRECTORY = '.output/public'
const NITRO_OUTPUT_DIRECTORY = '.output/server/chunks'

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
}

export interface ModuleOptions {
  host: string
  publicKey: string
  debug?: boolean
  clientConfig: Partial<PostHogConfig>
  serverConfig: PostHogOptions
  sourcemaps: DisabledSourcemaps | EnabledSourcemaps | undefined
}

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

    // general
    nuxt.options.runtimeConfig.public.posthogPublicKey =
      nuxt.options.runtimeConfig.public.posthogPublicKey || options.publicKey
    nuxt.options.runtimeConfig.public.posthogHost = nuxt.options.runtimeConfig.public.posthogHost || options.host
    nuxt.options.runtimeConfig.public.posthogDebug = nuxt.options.runtimeConfig.public.posthogDebug || options.debug

    // nuxt specific
    nuxt.options.runtimeConfig.public.posthogClientConfig =
      nuxt.options.runtimeConfig.public.posthogClientConfig || options.clientConfig

    // nitro specific
    nuxt.options.runtimeConfig.public.posthogServerConfig =
      nuxt.options.runtimeConfig.public.posthogServerConfig || options.serverConfig

    if (!options.sourcemaps?.enabled || nuxt.options.dev) {
      return
    }

    const sourcemapsConfig = options.sourcemaps as EnabledSourcemaps

    nuxt.hooks.hook('nitro:build:public-assets', async () => {
      try {
        await spawnLocal('posthog-cli', ['sourcemap', 'inject', '--directory', VUE_OUTPUT_DIRECTORY], {
          env: {
            ...process.env,
          },
          cwd: process.cwd(),
          resolveFrom: resolvedDirname,
          stdio: 'inherit',
          onBinaryFound: () => {},
        })
      } catch (error) {
        console.error('PostHog sourcemap inject failed:', error)
      }
    })

    nuxt.hooks.hook('close', async () => {
      try {
        await spawnLocal('posthog-cli', ['sourcemap', 'inject', '--directory', NITRO_OUTPUT_DIRECTORY], {
          env: {
            ...process.env,
          },
          cwd: process.cwd(),
          resolveFrom: resolvedDirname,
          stdio: 'inherit',
          onBinaryFound: () => {},
        })
      } catch (error) {
        console.error('PostHog sourcemap inject failed:', error)
      }

      const uploadEnv = {
        POSTHOG_CLI_ENV_ID: sourcemapsConfig.envId,
        POSTHOG_CLI_TOKEN: sourcemapsConfig.personalApiKey,
      }

      const serverUploadBaseOptions = []
      if (options.host) {
        serverUploadBaseOptions.push('--host', options.host)
      }
      serverUploadBaseOptions.push('sourcemap', 'upload')
      if (sourcemapsConfig.version) {
        serverUploadBaseOptions.push('--version', sourcemapsConfig.version)
      }
      if (sourcemapsConfig.project) {
        serverUploadBaseOptions.push('--project', sourcemapsConfig.project)
      }

      const nitroUploadConfig = [...serverUploadBaseOptions, '--directory', NITRO_OUTPUT_DIRECTORY]
      const vueUploadConfig = [...serverUploadBaseOptions, '--directory', VUE_OUTPUT_DIRECTORY]

      try {
        await spawnLocal('posthog-cli', nitroUploadConfig, {
          env: {
            ...process.env,
            ...uploadEnv,
          },
          cwd: process.cwd(),
          resolveFrom: resolvedDirname,
          stdio: 'inherit',
          onBinaryFound: () => {},
        })
      } catch (error) {
        console.error('PostHog sourcemap upload failed:', error)
      }

      try {
        await spawnLocal('posthog-cli', vueUploadConfig, {
          env: {
            ...process.env,
            ...uploadEnv,
          },
          cwd: process.cwd(),
          resolveFrom: resolvedDirname,
          stdio: 'inherit',
          onBinaryFound: () => {},
        })
      } catch (error) {
        console.error('PostHog sourcemap upload failed:', error)
      }
    })
  },
})
