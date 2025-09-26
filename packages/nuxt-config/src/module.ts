import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit'
import { execSync } from 'node:child_process'

export interface ModuleOptions {
  host: string
  publicApiKey: string
  exceptionAutoCaptureEnabled: boolean
  sourceMaps:
    | {
        enabled: false
        privateApiKey?: string
        envId?: string
        version?: string
        project?: string
      }
    | {
        enabled: true
        privateApiKey: string
        envId: string
        version?: string
        project?: string
      }
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@ablaszkiewicz/posthog-nuxt',
    configKey: 'posthog',
    compatibility: {
      nuxt: '>=3.7.0',
    },
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

      const publicUploadCmd = [
        `POSTHOG_CLI_ENV_ID=${options.sourceMaps.envId}`,
        `POSTHOG_CLI_TOKEN=${options.sourceMaps.privateApiKey}`,
        `posthog-cli --host ${options.host} sourcemap upload --directory .output/public`,
        options.sourceMaps.version ? `--version ${options.sourceMaps.version}` : '',
        options.sourceMaps.project ? `--project ${options.sourceMaps.project}` : '',
      ]
        .filter(Boolean)
        .join(' ')

      execSync(publicUploadCmd)

      const serverUploadCmd = [
        `POSTHOG_CLI_ENV_ID=${options.sourceMaps.envId}`,
        `POSTHOG_CLI_TOKEN=${options.sourceMaps.privateApiKey}`,
        `posthog-cli --host ${options.host} sourcemap upload --directory .output/server/chunks`,
        options.sourceMaps.version ? `--version ${options.sourceMaps.version}` : '',
        options.sourceMaps.project ? `--project ${options.sourceMaps.project}` : '',
      ]
        .filter(Boolean)
        .join(' ')

      execSync(serverUploadCmd)
    })
  },
})
