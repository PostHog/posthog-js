import { defineNuxtPlugin, useRuntimeConfig } from '#app'

import posthog from 'posthog-js'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const publicApiKey = runtimeConfig.public.posthogPublicKey as string
  const host = runtimeConfig.public.posthogHost as string

  if (!window || posthog.__loaded) {
    return
  }

  posthog.init(publicApiKey, {
    api_host: host,
    debug: true,
  })

  nuxtApp.hooks.hook('vue:error', async (error) => {
    posthog.captureException(error)
  })
  return {
    provide: {
      posthog: () => posthog,
    },
  }
})
