import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit'
import { execSync } from 'child_process'

// Module options TypeScript interface definition
export interface ModuleOptions {
  host: string
  publicApiKey: string
  sourceMaps:
    | {
        enabled: false
        privateApiKey?: string
        envId?: string
        version?: string
        projectName?: string
      }
    | {
        enabled: true
        privateApiKey: string
        envId: string
        version?: string
        projectName?: string
      }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@posthog/nuxt',
    configKey: 'posthog',
  },
  defaults: () => ({
    host: 'https://us.i.posthog.com',
  }),
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    addPlugin(resolver.resolve('./runtime/plugin'))

    nuxt.options.runtimeConfig.public.posthogPublicKey =
      nuxt.options.runtimeConfig.public.posthogPublicKey || options.publicApiKey
    nuxt.options.runtimeConfig.public.posthogHost = nuxt.options.runtimeConfig.public.posthogHost || options.host

    if (!options.sourceMaps.enabled) {
      return
    }

    nuxt.hooks.hook('nitro:build:public-assets', async () => {
      execSync('posthog-cli sourcemap inject --directory .output/public')
    })

    nuxt.hooks.hook('close', async () => {
      execSync('posthog-cli sourcemap inject --directory .output/server/chunks')

      execSync(
        `POSTHOG_CLI_ENV_ID=${options.sourceMaps.envId} POSTHOG_CLI_TOKEN=${options.sourceMaps.privateApiKey} posthog-cli --host ${options.host} sourcemap upload --directory .output/public --version ${options.sourceMaps.version} --project ${options.sourceMaps.projectName}`
      )

      execSync(
        `POSTHOG_CLI_ENV_ID=${options.sourceMaps.envId} POSTHOG_CLI_TOKEN=${options.sourceMaps.privateApiKey} posthog-cli --host ${options.host} sourcemap upload --directory .output/server/chunks --version ${options.sourceMaps.version} --project ${options.sourceMaps.projectName}`
      )
    })
  },
})
