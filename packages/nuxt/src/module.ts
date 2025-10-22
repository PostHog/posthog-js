import { defineNuxtModule, addPlugin, createResolver, addServerPlugin } from '@nuxt/kit'
import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import { spawnLocal } from '@posthog/core/process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const VUE_OUTPUT_DIRECTORY = '.output/public'
const NITRO_OUTPUT_DIRECTORY = '.output/server'

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
  clientConfig?: Partial<PostHogConfig>
  serverConfig?: PostHogOptions
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

    const cliEnv = {
      ...process.env,
      POSTHOG_CLI_ENV_ID: sourcemapsConfig.envId,
      POSTHOG_CLI_TOKEN: sourcemapsConfig.personalApiKey,
    }

    const sharedInjectOptions: string[] = [
      '--host',
      options.host,
      'sourcemap',
      'inject',
      '--ignore',
      '**/node_modules/**',
    ]
    if (options.sourcemaps.project) {
      sharedInjectOptions.push('--project', options.sourcemaps.project)
    }

    if (options.sourcemaps.version) {
      sharedInjectOptions.push('--version', options.sourcemaps.version)
    }

    nuxt.hooks.hook('nitro:build:public-assets', async () => {
      try {
        await spawnLocal('posthog-cli', [...sharedInjectOptions, '--directory', VUE_OUTPUT_DIRECTORY], {
          env: cliEnv,
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
        await spawnLocal('posthog-cli', [...sharedInjectOptions, '--directory', NITRO_OUTPUT_DIRECTORY], {
          env: cliEnv,
          cwd: process.cwd(),
          resolveFrom: resolvedDirname,
          stdio: 'inherit',
          onBinaryFound: () => {},
        })
      } catch (error) {
        console.error('PostHog sourcemap inject failed:', error)
      }

      const uploadOptions = [
        '--host',
        options.host,
        'sourcemap',
        'upload',
        '--directory',
        '.output',
        '--ignore',
        '**/node_modules/**',
      ]

      try {
        await spawnLocal('posthog-cli', uploadOptions, {
          env: cliEnv,
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
