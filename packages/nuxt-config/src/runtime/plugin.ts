import { defineNuxtPlugin, useRuntimeConfig } from '#app'

import posthog from 'posthog-js'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const publicApiKey = runtimeConfig.public.posthogPublicKey as string
  const host = runtimeConfig.public.posthogHost as string
  console.log('Initializing posthog client')
  if (posthog.init) {
    try {
      posthog.init(publicApiKey, {
        api_host: host,
        debug: true,
      })
    } catch (e) {
      console.log('Error initializing posthog client')
      console.log(e)
    }
  }
  console.log('Posthog client initialized')
  nuxtApp.hooks.hook('vue:error', async (error) => {
    console.log('----------- HOOK vue:error START ------------')
    console.log(error)
    posthog.captureException(error)
    console.log('----------- HOOK vue:error END ------------')
  })
  return {
    provide: {
      posthog: () => posthog,
    },
  }
})
