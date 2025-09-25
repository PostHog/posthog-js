import { defineNuxtModule, addPlugin, createResolver } from '@nuxt/kit'
import { exec, execSync } from 'child_process'

// Module options TypeScript interface definition
export interface ModuleOptions {
  host: string
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@posthog/nuxt',
    configKey: 'posthog',
  },
  defaults: (nuxt) => ({
    host: 'https://from-defaults.i.posthog.com',
  }),
  setup(_options, nuxt) {
    const resolver = createResolver(import.meta.url)

    // Do not add the extension since the `.ts` will be transpiled to `.mjs` after `npm run prepack`
    addPlugin(resolver.resolve('./runtime/plugin'))

    nuxt.hooks.hook('close', async (nuxt) => {
      console.log('Injecting frontend sourcemaps')
      execSync('posthog-cli sourcemap inject --directory .output/public/_nuxt')
      console.log('After injecting')

      console.log('Injecting backend sourcemaps')
      execSync('posthog-cli sourcemap inject --directory .output/server/chunks')
      console.log('After injecting')
    })
  },
})
