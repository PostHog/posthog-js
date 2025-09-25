import { defineNuxtPlugin, useRuntimeConfig } from '#app'

import posthog from 'posthog-js'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()

  const publicApiKey = runtimeConfig.public.posthogPublicKey as string
  const host = runtimeConfig.public.posthogHost as string

  const client = posthog.init(publicApiKey, {
    api_host: host,
    debug: true,
  })

  nuxtApp.hooks.hook('vue:error', async (error) => {
    console.log('----------- HOOK vue:error START ------------')

    console.log(error)
    client.captureException(error)

    console.log('----------- HOOK vue:error END ------------')
  })

  return {
    provide: {
      posthog: () => client,
    },
  }
})
